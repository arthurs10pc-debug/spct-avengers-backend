// High-Performance Stealth Google Places Rank Scraper
// Uses local Chrome installation to fetch 100% Genuine Real-Time Google Maps / Places rankings for free

let puppeteerModule = null;

async function getPuppeteer() {
  if (!puppeteerModule) {
    const mod = await import('puppeteer-core');
    puppeteerModule = mod.default || mod;
  }
  return puppeteerModule;
}

const CHROME_PATH = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

/**
 * Searches Google Maps in real-time for a single keyword and determines target business rank
 */
async function searchSingleKeyword(page, keyword, targetBusinessName) {
  try {
    const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(keyword)}?hl=en`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
    
    // Allow Google Maps client rendering
    await new Promise(r => setTimeout(r, 3200));

    const places = await page.evaluate(() => {
      const list = [];
      
      // 1. Links with place href
      document.querySelectorAll('a[href*="/maps/place/"]').forEach(a => {
        const aria = a.getAttribute('aria-label');
        if (aria && !list.includes(aria)) list.push(aria);
      });

      // 2. Headline titles in results feed
      if (list.length === 0) {
        document.querySelectorAll('div.fontHeadlineSmall').forEach(el => {
          const t = el.innerText.trim();
          if (t && !list.includes(t)) list.push(t);
        });
      }

      // 3. Aria-labels of feed items
      if (list.length === 0) {
        document.querySelectorAll('div[role="feed"] div[aria-label]').forEach(el => {
          const t = el.getAttribute('aria-label');
          if (t && !list.includes(t)) list.push(t);
        });
      }

      return list;
    });

    const cleanTarget = targetBusinessName.toLowerCase().trim();
    let foundRank = '20+';
    let matchedTitle = null;

    for (let i = 0; i < places.length; i++) {
      const pName = places[i].toLowerCase();
      // Match exact name or significant keyword overlap
      if (pName.includes(cleanTarget) || cleanTarget.includes(pName)) {
        foundRank = String(i + 1);
        matchedTitle = places[i];
        break;
      }
    }

    // Secondary fuzzy match (e.g., words match)
    if (foundRank === '20+') {
      const targetWords = cleanTarget.split(/\s+/).filter(w => w.length > 3 && !['best', 'services', 'service', 'for', 'in', 'near', 'the', 'and'].includes(w));
      if (targetWords.length > 0) {
        for (let i = 0; i < places.length; i++) {
          const pName = places[i].toLowerCase();
          const matchCount = targetWords.filter(w => pName.includes(w)).length;
          if (matchCount >= Math.min(2, targetWords.length)) {
            foundRank = String(i + 1);
            matchedTitle = places[i];
            break;
          }
        }
      }
    }

    return {
      keyword,
      rank: foundRank,
      matchedTitle,
      topPlaces: places.slice(0, 5),
      totalFound: places.length
    };
  } catch (err) {
    console.error(`Error scraping keyword "${keyword}":`, err.message);
    return {
      keyword,
      rank: '20+',
      error: err.message,
      topPlaces: []
    };
  }
}

/**
 * Scans a list of keywords in batch, emitting progress events
 */
async function scanBatchKeywords({ keywords, targetBusinessName, onProgress }) {
  const puppeteer = await getPuppeteer();
  
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: "new",
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--lang=en-US,en',
      '--window-size=1280,900'
    ]
  });

  const results = [];

  try {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

    for (let i = 0; i < keywords.length; i++) {
      const kw = keywords[i];
      const res = await searchSingleKeyword(page, kw, targetBusinessName);
      results.push(res);

      if (onProgress) {
        onProgress({
          index: i,
          total: keywords.length,
          keyword: kw,
          rank: res.rank,
          matchedTitle: res.matchedTitle,
          topPlaces: res.topPlaces,
          progress: Math.round(((i + 1) / keywords.length) * 100)
        });
      }
    }
  } finally {
    try {
      await browser.close();
    } catch (e) {}
  }

  return results;
}

/**
 * Searches a single keyword standalone (opens browser, searches, closes browser)
 */
async function scanSingleKeywordStandalone(keyword, targetBusinessName) {
  const puppeteer = await getPuppeteer();
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: "new",
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--lang=en-US,en',
      '--window-size=1280,900'
    ]
  });
  try {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    return await searchSingleKeyword(page, keyword, targetBusinessName);
  } finally {
    try {
      await browser.close();
    } catch (e) {}
  }
}

module.exports = {
  searchSingleKeyword,
  scanBatchKeywords,
  scanSingleKeywordStandalone
};
