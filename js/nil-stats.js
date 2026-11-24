// Chart and statistic helpers for visuals.html and correlation.html.
// Everything is calculated from nilData (js/nil-data.js), so the charts always
// match the dataset. Rebuild nil-data.js from the spreadsheet; do not type
// numbers into the HTML.
const NIL = (() => {
  const SEASONS = { football: '2025', basketball: '2025–26', baseball: '2026', volleyball: '2025' };

  // Postseason groups, in chart order. Teams whose postseason is unknown are left out.
  const BUCKETS = {
    football: ['No Postseason', 'Bowl Game', 'CFP First Round', 'CFP Quarterfinal', 'CFP Semifinal / Final', 'National Champion'],
    basketball: ['No Postseason', 'NIT / CBB Crown', 'NCAA First Weekend', 'Sweet 16 / Elite 8', 'Final Four / Title Game'],
    baseball: ['No Postseason', 'NCAA Regional', 'Super Regional', 'College World Series', 'National Champion'],
    volleyball: ['No Postseason', 'NCAA First Weekend', 'Sweet 16 / Elite 8', 'Final Four / Final', 'National Champion'],
  };

  function bucket(sport, r) {
    const t = r.tournament, s = r.stage;
    if (!t) return 'No Postseason';
    if (t === 'Unknown') return null;
    if (sport === 'football') {
      if (t === 'Bowl') return 'Bowl Game';
      return { 'CFP first round': 'CFP First Round', 'CFP quarterfinal': 'CFP Quarterfinal', 'CFP semifinal': 'CFP Semifinal / Final',
               'National runner-up': 'CFP Semifinal / Final', 'National champion': 'National Champion' }[s] || null;
    }
    if (sport === 'basketball') {
      if (t === 'NIT' || t === 'CBB Crown') return 'NIT / CBB Crown';
      return { 'First Four': 'NCAA First Weekend', 'Round of 64': 'NCAA First Weekend', 'Round of 32': 'NCAA First Weekend',
               'Sweet 16': 'Sweet 16 / Elite 8', 'Elite Eight': 'Sweet 16 / Elite 8', 'Final Four': 'Final Four / Title Game',
               'National runner-up': 'Final Four / Title Game', 'National champion': 'Final Four / Title Game' }[s] || null;
    }
    if (sport === 'baseball') {
      return { 'Regional': 'NCAA Regional', 'Super Regional': 'Super Regional', 'College World Series': 'College World Series',
               'National runner-up': 'College World Series', 'National champion': 'National Champion' }[s] || null;
    }
    return { 'Round of 64': 'NCAA First Weekend', 'Round of 32': 'NCAA First Weekend', 'Sweet 16': 'Sweet 16 / Elite 8',
             'Elite Eight': 'Sweet 16 / Elite 8', 'Final Four': 'Final Four / Final', 'National runner-up': 'Final Four / Final',
             'National champion': 'National Champion' }[s] || null;
  }

  const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
  const rows = sport => (nilData[sport] || []).filter(r => r.nil);

  function top10(sport) {
    const t = [...rows(sport)].sort((a, b) => b.nil - a.nil).slice(0, 10);
    return { labels: t.map(r => r.school), vals: t.map(r => r.nil) };
  }

  function confAvg(sport) {
    const g = {};
    rows(sport).forEach(r => (g[r.conference] = g[r.conference] || []).push(r.nil));
    const e = Object.entries(g).map(([k, v]) => [k, mean(v)]).sort((a, b) => b[1] - a[1]);
    return { labels: e.map(x => x[0]), vals: e.map(x => Math.round(x[1])) };
  }

  const points = sport => rows(sport).map(r => ({ x: r.nil, y: r.win_pct, label: r.school }));

  function postseason(sport) {
    const g = {};
    rows(sport).forEach(r => { const b = bucket(sport, r); if (b) (g[b] = g[b] || []).push(r.nil); });
    const labels = BUCKETS[sport].filter(b => g[b]);
    return { labels, vals: labels.map(b => Math.round(mean(g[b]))), counts: labels.map(b => g[b].length) };
  }

  function pearson(sport) {
    const p = points(sport), mx = mean(p.map(d => d.x)), my = mean(p.map(d => d.y));
    let sxy = 0, sxx = 0, syy = 0;
    p.forEach(d => { sxy += (d.x - mx) * (d.y - my); sxx += (d.x - mx) ** 2; syy += (d.y - my) ** 2; });
    return { r: sxy / Math.sqrt(sxx * syy), n: p.length };
  }

  function strength(r) {
    const a = Math.abs(r);
    const s = a >= 0.7 ? 'Strong' : a >= 0.3 ? 'Moderate' : a >= 0.1 ? 'Weak' : 'No clear';
    return s + (r >= 0 ? ' Positive' : ' Negative');
  }

  return { SEASONS, top10, confAvg, points, postseason, pearson, strength, rows };
})();
