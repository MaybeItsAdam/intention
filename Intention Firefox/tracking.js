function dateKey(date) {
  const d = date || new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function daysAgoKeys(n) {
  const keys = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    keys.push(dateKey(d));
  }
  return keys;
}

function getStorage(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

function setStorage(obj) {
  return new Promise(resolve => chrome.storage.local.set(obj, resolve));
}

async function withDailyStats(mutator) {
  const { dailyStats = {} } = await getStorage(['dailyStats']);
  const today = dateKey();
  if (!dailyStats[today]) dailyStats[today] = {};
  mutator(dailyStats, today);
  const allKeys = Object.keys(dailyStats).sort().reverse();
  if (allKeys.length > 30) {
    for (const old of allKeys.slice(30)) delete dailyStats[old];
  }
  await setStorage({ dailyStats });
}

async function recordGrant(domain, minutes, reason) {
  await withDailyStats((stats, today) => {
    if (!stats[today][domain]) stats[today][domain] = { minutes: 0, grants: 0, sessions: [] };
    stats[today][domain].grants += 1;
    stats[today][domain].sessions.push({ grantedMinutes: minutes, reason, grantedAt: Date.now() });
  });
}

async function recordSessionMinutes(domain, elapsedMinutes) {
  if (!domain || elapsedMinutes <= 0) return;
  await withDailyStats((stats, today) => {
    if (!stats[today][domain]) stats[today][domain] = { minutes: 0, grants: 0, sessions: [] };
    stats[today][domain].minutes += elapsedMinutes;
  });
}

async function getStatsForDomain(domain) {
  const { dailyStats = {} } = await getStorage(['dailyStats']);
  const todayKey = dateKey();
  const weekKeys = daysAgoKeys(7);
  const monthKeys = daysAgoKeys(30);

  let minutesToday = 0, grantsToday = 0, minutesWeek = 0, minutesMonth = 0;
  let minutesTodayAll = 0, minutesWeekAll = 0;

  for (const [k, entries] of Object.entries(dailyStats)) {
    for (const [d, site] of Object.entries(entries)) {
      if (d === domain) {
        if (k === todayKey) {
          minutesToday = site.minutes || 0;
          grantsToday = site.grants || 0;
        }
        if (weekKeys.includes(k)) minutesWeek += site.minutes || 0;
        if (monthKeys.includes(k)) minutesMonth += site.minutes || 0;
      }
      if (k === todayKey) minutesTodayAll += site.minutes || 0;
      if (weekKeys.includes(k)) minutesWeekAll += site.minutes || 0;
    }
  }

  return {
    minutesToday: Math.round(minutesToday),
    minutesWeek: Math.round(minutesWeek),
    minutesMonth: Math.round(minutesMonth),
    grantsToday,
    minutesTodayAll: Math.round(minutesTodayAll),
    minutesWeekAll: Math.round(minutesWeekAll)
  };
}

async function getStatsSummary() {
  const { dailyStats = {} } = await getStorage(['dailyStats']);
  const todayKey = dateKey();
  const weekKeys = daysAgoKeys(7);

  let minutesToday = 0, minutesWeek = 0;
  const perSiteToday = {};

  for (const [k, entries] of Object.entries(dailyStats)) {
    for (const [domain, site] of Object.entries(entries)) {
      if (k === todayKey) {
        minutesToday += site.minutes || 0;
        perSiteToday[domain] = (perSiteToday[domain] || 0) + (site.minutes || 0);
      }
      if (weekKeys.includes(k)) minutesWeek += site.minutes || 0;
    }
  }

  return {
    minutesToday: Math.round(minutesToday),
    minutesWeek: Math.round(minutesWeek),
    perSiteToday
  };
}
