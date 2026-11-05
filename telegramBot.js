// Shadow Dashboard Telegram Bot Engine
// Real-Time Bi-Directional Mirror with MongoDB & WebSockets

const PRIMARY_EMAIL = 'sataparahetkumar@gmail.com';
const ALIAS_EMAILS = ['sataparahetkumar786@gmail.com', 'hetsatapara@gmail.com'];

function initTelegramBot({ User, io, mergeExpenses, botToken, sendPushToUser }) {
  const token = botToken || process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn('[Telegram Bot] TELEGRAM_BOT_TOKEN not provided, skipping initialization.');
    return { sendAlert: async () => false };
  }

  const broadcastAll = (payload) => {
    if (!io) return;
    const allEmails = [PRIMARY_EMAIL, ...ALIAS_EMAILS];
    allEmails.forEach(e => io.to(`user:${e}`).emit('user_data_synced', payload));
  };

  const mirrorAliases = async (updates) => {
    try {
      for (const em of ALIAS_EMAILS) {
        await User.updateOne({ email: em }, { $set: { ...updates, email: em, updatedAt: new Date() } }, { upsert: true });
      }
    } catch (e) {}
  };

  const BASE_URL = `https://api.telegram.org/bot${token}`;
  let lastUpdateId = 0;
  let isPolling = true;

  // Helper: Call Telegram Bot API
  async function apiCall(method, body = {}) {
    try {
      const res = await fetch(`${BASE_URL}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      return await res.json();
    } catch (err) {
      console.warn(`[Telegram API Error ${method}]:`, err.message);
      return { ok: false, error: err.message };
    }
  }

  // Send message helper
  async function sendMessage(chatId, text, extra = {}) {
    return apiCall('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      ...extra
    });
  }

  // Auto-categorize expenses based on keywords
  function detectCategory(text) {
    const lower = text.toLowerCase();
    if (/petrol|diesel|fuel|auto|rickshaw|taxi|cab|uber|ola|bus|train|metro|flight|parking|toll/i.test(lower)) {
      return 'Fuel & Commute';
    }
    if (/food|nasto|chai|tea|coffee|breakfast|lunch|dinner|snack|restaurant|hotel|swiggy|zomato|pizza|burger|milk|bread|grocery|groceries|sabzi|veg/i.test(lower)) {
      return 'Food & Snacks';
    }
    if (/shopping|clothes|shirt|pants|shoes|amazon|flipkart|myntra|mall|electronics|gadget|watch|bag/i.test(lower)) {
      return 'Shopping';
    }
    if (/bill|electricity|light|wifi|internet|mobile|recharge|rent|maintenance|water|gas|cylinder/i.test(lower)) {
      return 'Bills & Utilities';
    }
    if (/medicine|doctor|medical|hospital|pharmacy|tablet|clinic|dental|test|lab/i.test(lower)) {
      return 'Medical';
    }
    return 'General';
  }

  // Parse natural language expense (e.g. "150 coffee", "petrol 200", "expense 500 clothes", "100 nasto")
  function parseExpense(text) {
    const clean = text.trim();
    // Pattern A: "150 coffee" or "₹150 coffee" or "150rs coffee"
    const matchA = clean.match(/^(?:expense|kharcha)?\s*[₹rs.]*\s*(\d+(?:\.\d+)?)\s*(?:rs|rupees|ka)?\s+(.+)$/i);
    if (matchA) {
      return {
        amount: parseFloat(matchA[1]),
        title: matchA[2].replace(/^(?:ka|for|ki|on)\s+/i, '').trim()
      };
    }

    // Pattern B: "coffee 150" or "petrol 200rs"
    const matchB = clean.match(/^(.+?)\s+[₹rs.]*\s*(\d+(?:\.\d+)?)\s*(?:rs|rupees|ka)?$/i);
    if (matchB) {
      return {
        amount: parseFloat(matchB[2]),
        title: matchB[1].replace(/^(?:expense|kharcha)\s+/i, '').trim()
      };
    }

    return null;
  }

  // Parse reminder (e.g. "remind 17:30 gym", "reminder: 09:00 morning wrap")
  function parseReminder(text) {
    const clean = text.trim();
    // Match "remind [me] [at] 14:30 task" or "reminder 14:30 task"
    const match = clean.match(/^(?:remind\s*me(?:\s*at)?|reminder:?)\s*(\d{1,2}[:.]\d{2})\s*(?:am|pm)?\s+(.+)$/i);
    if (match) {
      let timeStr = match[1].replace('.', ':');
      if (timeStr.length === 4 && timeStr[1] === ':') timeStr = '0' + timeStr;
      return {
        time: timeStr,
        task: match[2].trim()
      };
    }
    return null;
  }

  // Handle single incoming message
  async function handleMessage(msg) {
    if (!msg || !msg.text || !msg.chat) return;

    const chatId = msg.chat.id;
    const rawText = msg.text.trim();
    const senderName = msg.from?.first_name || 'Commander';
    const username = msg.from?.username || '';

    // Always ensure user is bound in DB to Commander account
    let user = await User.findOne({ email: PRIMARY_EMAIL });
    if (!user) {
      user = await User.create({
        email: PRIMARY_EMAIL,
        fullName: 'Het Satapara',
        telegramChatId: String(chatId),
        telegramUsername: username,
        updatedAt: new Date()
      });
    } else if (user.telegramChatId !== String(chatId)) {
      user.telegramChatId = String(chatId);
      user.telegramUsername = username;
      await user.save();
    }

    // 1. /start command
    if (rawText === '/start') {
      const welcome = `⚡ <b>SHADOW NEURAL ASSISTANT</b>\n\n` +
        `Welcome back, <b>Commander ${user.fullName || senderName}</b>!\n` +
        `Your Telegram is now linked to your <b>Shadow Dashboard</b> in real time.\n\n` +
        `🕒 <b>Automated 3x Daily Notes & Phone Push Schedule:</b>\n` +
        `• <b>Morning:</b> 08:00 AM IST\n` +
        `• <b>Afternoon:</b> 01:00 PM IST\n` +
        `• <b>Evening:</b> 08:30 PM IST\n` +
        `<i>Every single note (pinned on top) is automatically dispatched to this bot AND triggers a mobile notification on your phone via Shadow app!</i>\n\n` +
        `📌 <b>Instant Commands:</b>\n` +
        `• /sendnotes - Instantly dispatch all notes here & fire phone notification\n` +
        `• /notes - View all Google Keep notes right now\n` +
        `• /status - Live overview of budget, expenses & notes\n` +
        `• /expenses - Recent transactions list\n` +
        `• /routines - Watcher schedule & reminders\n\n` +
        `💬 <b>Natural Actions (Type anytime):</b>\n` +
        `• <code>150 coffee</code> or <code>200 petrol</code> ➔ Logs expense\n` +
        `• <code>Note: Buy milk and bread</code> ➔ Saves to Notes\n` +
        `• <code>Pin note: Meeting at 5pm</code> ➔ Saves pinned note\n` +
        `• <code>Remind 18:30 gym workout</code> ➔ Sets Watcher alert\n\n` +
        `🚀 <i>All entries mirror instantly to your laptop & mobile screens!</i>`;
      return sendMessage(chatId, welcome);
    }

    // 2. /status or /summary
    if (rawText === '/status' || rawText === '/summary') {
      const d = new Date();
      const currentMonthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const expenses = user.expenses || [];
      const monthlyItems = expenses.filter(i => i && i.type !== 'income' && String(i.date || '').includes(currentMonthStr));
      const totalSpent = monthlyItems.reduce((sum, i) => sum + (parseFloat(i.amount) || 0), 0);
      const budget = user.monthlyBudget || 5000;
      const remaining = Math.max(0, budget - totalSpent);
      const pct = budget > 0 ? Math.round((totalSpent / budget) * 100) : 0;

      const notes = user.notes || [];
      const pinnedCount = notes.filter(n => n.pinned).length;
      const reminders = user.reminders || [];
      const activeReminders = reminders.filter(r => !r.completed);

      const statusMsg = `📊 <b>SHADOW EXECUTIVE STATUS</b>\n\n` +
        `💰 <b>Monthly Budget:</b> ₹${budget.toLocaleString('en-IN')}\n` +
        `💸 <b>Spent So Far:</b> ₹${totalSpent.toLocaleString('en-IN')} (${pct}%)\n` +
        `💳 <b>Remaining:</b> ₹${remaining.toLocaleString('en-IN')}\n\n` +
        `📝 <b>Google Keep Notes:</b> ${notes.length} total (${pinnedCount} pinned)\n` +
        `⏰ <b>Watcher Routines:</b> ${activeReminders.length} active\n\n` +
        `🕒 <b>Daily Notes Dispatch:</b> 08:00 AM, 01:00 PM, 08:30 PM IST\n` +
        `🔗 <i>All systems operational & synced across your devices.</i>`;
      return sendMessage(chatId, statusMsg);
    }

    // 3. /expenses
    if (rawText === '/expenses') {
      const expenses = (user.expenses || []).slice(0, 6);
      if (expenses.length === 0) {
        return sendMessage(chatId, '💳 No expenses logged yet. Send <code>150 coffee</code> to add one!');
      }
      let listStr = `💳 <b>RECENT TRANSACTIONS:</b>\n\n`;
      expenses.forEach((e, idx) => {
        listStr += `${idx + 1}. <b>${e.title || 'Expense'}</b>: ₹${e.amount} (${e.category || 'General'}) • <i>${e.date || ''}</i>\n`;
      });
      return sendMessage(chatId, listStr);
    }

    // 4. /notes and /sendnotes / /briefing
    if (rawText === '/sendnotes' || rawText === '/briefing' || rawText === '/notes') {
      const notes = user.notes || [];
      const pinnedNotes = notes.filter(n => n && (n.pinned === true || n.pinned === 'true'));
      const regularNotes = notes.filter(n => !n || (n.pinned !== true && n.pinned !== 'true'));
      const sortedNotes = [...pinnedNotes, ...regularNotes];

      if (sortedNotes.length === 0) {
        return sendMessage(chatId, '📝 <b>No notes found.</b>\nSend <code>Note: your text</code> or <code>Pin note: important</code> here to add one anytime!');
      }

      const nowIST = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true });
      const dateIST = new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });

      let notesStr = `⚡ <b>SHADOW NOTES BRIEFING</b>\n` +
        `🕒 <b>Time:</b> ${nowIST} IST (${dateIST})\n` +
        `📊 <b>Total Notes:</b> ${sortedNotes.length} (${pinnedNotes.length} Pinned ⭐)\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

      sortedNotes.forEach((n, idx) => {
        const isPinned = n.pinned === true || n.pinned === 'true';
        const pinBadge = isPinned ? '⭐ <b>[PINNED]</b> ' : `<b>#${idx + 1}</b> `;
        const title = (n.title || (n.type === 'task' ? 'Task Item' : 'Note')).trim();
        const content = (n.content || '').trim();
        const dateStr = n.date || n.createdAt || '';

        const escapeTg = (str) => String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        notesStr += `${pinBadge}<b>${escapeTg(title)}</b>\n`;
        if (content) {
          notesStr += `📄 ${escapeTg(content)}\n`;
        }
        if (Array.isArray(n.checklist) && n.checklist.length > 0) {
          n.checklist.forEach(c => {
            notesStr += `${c.completed ? '✅' : '⬜'} ${escapeTg(c.text || '')}\n`;
          });
        }
        if (dateStr) {
          notesStr += `🕒 <i>Saved: ${escapeTg(dateStr)}</i>\n`;
        }
        notesStr += `\n`;
      });

      notesStr += `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🔔 <b>Automated Delivery Schedule:</b>\n` +
        `• Morning 08:00 AM IST\n` +
        `• Afternoon 01:00 PM IST\n` +
        `• Evening 08:30 PM IST\n\n` +
        `📱 <i>Auto-synced to your mobile app & desktop screens!</i>`;

      // Trigger Web Push Notification if sendnotes requested or on demand
      if (typeof sendPushToUser === 'function') {
        const topNotesPreview = sortedNotes.slice(0, 3).map(n => (n.pinned ? '⭐ ' : '• ') + (n.title || 'Note')).join('\n');
        sendPushToUser(user.email, {
          title: `📝 Shadow Notes Briefing [${nowIST} IST]`,
          body: `${sortedNotes.length} notes ready (${pinnedNotes.length} pinned):\n${topNotesPreview}`,
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          url: '/?tab=notes',
          tag: `shadow-instant-briefing-${Date.now()}`
        }).catch(err => console.warn('[Telegram /sendnotes Push Error]:', err.message));
      }

      return sendMessage(chatId, notesStr);
    }

    // 5. /routines
    if (rawText === '/routines') {
      const reminders = user.reminders || [];
      if (reminders.length === 0) {
        return sendMessage(chatId, '⏰ No Watcher routines configured.');
      }
      let remStr = `⏰ <b>WATCHER ROUTINES SCHEDULE:</b>\n\n`;
      reminders.forEach((r, idx) => {
        const check = r.completed ? '✅' : '⏳';
        remStr += `${idx + 1}. ${check} <b>${r.time} IST</b> — ${r.task}\n`;
      });
      return sendMessage(chatId, remStr);
    }

    // 6. Check for Note Addition (e.g. "Note: meeting at 3pm", "Pin note: check report")
    const noteMatch = rawText.match(/^(?:pin\s+note|note|add\s+note)[:\s]+(.+)$/i);
    if (noteMatch) {
      const isPinned = /^pin\s+note/i.test(rawText);
      const noteContent = noteMatch[1].trim();
      const firstLine = noteContent.split('\n')[0];
      const title = firstLine.length > 40 ? firstLine.slice(0, 40) + '...' : firstLine;

      const newNote = {
        id: 'note_' + Date.now(),
        title: title || 'Quick Note',
        content: noteContent,
        pinned: isPinned,
        color: '#ffffff',
        tags: ['telegram', 'quick'],
        createdAt: new Date().toISOString(),
        date: new Date().toLocaleDateString('en-GB')
      };

      const updatedNotes = [newNote, ...(user.notes || [])];
      user.notes = updatedNotes;
      user.updatedAt = new Date();
      await user.save();
      await mirrorAliases({ notes: updatedNotes, expenses: user.expenses || [], reminders: user.reminders || [] });

      // Broadcast in real-time to Laptop and Mobile dashboards
      broadcastAll({
        email: PRIMARY_EMAIL,
        notes: updatedNotes,
        expenses: user.expenses || [],
        reminders: user.reminders || []
      });

      const reply = `📝 <b>NOTE SAVED TO DASHBOARD!</b>\n\n` +
        `📌 <b>Pinned:</b> ${isPinned ? 'Yes ⭐' : 'No'}\n` +
        `📄 <b>Title:</b> ${title}\n` +
        `💬 <i>"${noteContent}"</i>\n\n` +
        `✅ Synced to your laptop & mobile dashboard, and queued for 3x daily email dispatch.`;
      return sendMessage(chatId, reply);
    }

    // 7. Check for Watcher Reminder Addition (e.g. "Remind 17:30 send email")
    const remData = parseReminder(rawText);
    if (remData) {
      const newRem = {
        id: 'rem_' + Date.now(),
        task: remData.task,
        time: remData.time,
        completed: false,
        source: 'telegram'
      };

      const updatedReminders = [...(user.reminders || []), newRem];
      // Sort chronologically by time
      updatedReminders.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
      user.reminders = updatedReminders;
      user.updatedAt = new Date();
      await user.save();
      await mirrorAliases({ reminders: updatedReminders, notes: user.notes || [], expenses: user.expenses || [] });

      broadcastAll({
        email: PRIMARY_EMAIL,
        reminders: updatedReminders,
        notes: user.notes || [],
        expenses: user.expenses || []
      });

      const reply = `⏰ <b>WATCHER REMINDER CREATED!</b>\n\n` +
        `🕒 <b>Time:</b> ${remData.time} IST\n` +
        `📋 <b>Task:</b> ${remData.task}\n\n` +
        `🔔 Background push alert & Telegram alert scheduled!`;
      return sendMessage(chatId, reply);
    }

    // 8. Check for Expense Addition (e.g. "150 coffee", "200 petrol", "dinner 450")
    const expData = parseExpense(rawText);
    if (expData && expData.amount > 0) {
      const now = new Date();
      const dateFormatted = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
      const category = detectCategory(expData.title);

      const newExpense = {
        id: `tx_${dateFormatted}_${expData.title}_${expData.amount}_${Date.now()}`,
        title: expData.title,
        amount: expData.amount,
        category: category,
        type: 'expense',
        date: dateFormatted,
        createdAt: Date.now(),
        source: 'telegram'
      };

      const updatedExpenses = mergeExpenses(user.expenses || [], [newExpense], []);
      user.expenses = updatedExpenses;
      user.updatedAt = new Date();
      await user.save();
      await mirrorAliases({ expenses: updatedExpenses, notes: user.notes || [], reminders: user.reminders || [] });

      // Real-time broadcast to all open dashboard screens
      broadcastAll({
        email: PRIMARY_EMAIL,
        expenses: updatedExpenses,
        notes: user.notes || [],
        reminders: user.reminders || []
      });

      // Calculate new budget status
      const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const monthlyItems = updatedExpenses.filter(i => i && i.type !== 'income' && String(i.date || '').includes(currentMonthStr));
      const totalSpent = monthlyItems.reduce((sum, i) => sum + (parseFloat(i.amount) || 0), 0);
      const budget = user.monthlyBudget || 5000;
      const remaining = Math.max(0, budget - totalSpent);
      const pct = budget > 0 ? Math.round((totalSpent / budget) * 100) : 0;

      const reply = `💰 <b>EXPENSE LOGGED SUCCESSFULLY!</b>\n\n` +
        `🏷️ <b>Item:</b> ${expData.title}\n` +
        `💵 <b>Amount:</b> ₹${expData.amount.toLocaleString('en-IN')}\n` +
        `📂 <b>Category:</b> ${category}\n\n` +
        `📊 <b>Monthly Spent:</b> ₹${totalSpent.toLocaleString('en-IN')} / ₹${budget.toLocaleString('en-IN')} (${pct}%)\n` +
        `💳 <b>Remaining:</b> ₹${remaining.toLocaleString('en-IN')}\n\n` +
        `⚡ <i>Live updated on your laptop & phone dashboard!</i>`;
      return sendMessage(chatId, reply);
    }

    // Fallback: Helpful suggestions
    const helpMsg = `🤖 <b>Shadow didn't catch that.</b>\n\n` +
      `Try one of these formats:\n` +
      `• <code>150 coffee</code> ➔ Log ₹150 expense\n` +
      `• <code>200 petrol</code> ➔ Log ₹200 expense\n` +
      `• <code>Note: Buy milk and bread</code> ➔ Save note\n` +
      `• <code>Remind 17:30 gym</code> ➔ Set routine alert\n` +
      `• /status ➔ View overall summary`;
    return sendMessage(chatId, helpMsg);
  }

  // Polling loop for receiving updates
  async function pollUpdates() {
    while (isPolling) {
      try {
        const res = await apiCall('getUpdates', {
          offset: lastUpdateId + 1,
          timeout: 25,
          allowed_updates: ['message']
        });

        if (res && res.ok && Array.isArray(res.result)) {
          for (const update of res.result) {
            lastUpdateId = Math.max(lastUpdateId, update.update_id);
            if (update.message) {
              await handleMessage(update.message);
            }
          }
        }
      } catch (err) {
        // Sleep briefly on error before retrying
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  }

  // Launch polling in background
  pollUpdates();
  console.log('[Telegram Bot] Shadow Telegram Bot listener active for @shadow_assistant05_bot');

  // Return controller with alert dispatcher
  return {
    sendAlert: async (chatId, text) => {
      const targetId = chatId || (await User.findOne({ email: PRIMARY_EMAIL }))?.telegramChatId;
      if (targetId) {
        return sendMessage(targetId, text);
      }
      return false;
    },
    stop: () => {
      isPolling = false;
    }
  };
}

module.exports = { initTelegramBot };
