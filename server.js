require('dotenv').config({ override: true });
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const nilData = require('./data/nil-data.json');

const PORT = process.env.PORT || 8000;

if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === 'your-api-key-here') {
  console.warn(
    '\n[NIL Index] WARNING: ANTHROPIC_API_KEY is not set in .env — the AI Assistant endpoint will fail until you add your key.\n' +
    '  1. Get a key at https://console.anthropic.com\n' +
    '  2. Open the .env file in this folder and replace "your-api-key-here" with your real key\n' +
    '  3. Restart the server (Ctrl+C, then `npm start`)\n'
  );
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(__dirname));

const SPORTS = ['football', 'basketball', 'baseball', 'volleyball'];

// Regression coefficients computed from the exact NIL-spend-vs-win% datasets
// used on correlation.html (win% = slope * nil_spend + intercept).
const REGRESSION = {
  football:   { slope: 1.4283114579e-06, intercept: 20.8901, r: 0.604 },
  basketball: { slope: 1.8206928529e-06, intercept: 45.7054, r: 0.446 },
  baseball:   { slope: 1.0327897364e-05, intercept: 54.3762, r: 0.523 },
  volleyball: { slope: 4.2438075856e-05, intercept: 45.4444, r: 0.830 },
};

function fmtMoney(n) {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(0)}K`;
  return `$${n}`;
}

// ---------- Tool implementations ----------

function toolLookupTeam(input) {
  const sport = (input.sport || '').toLowerCase();
  const school = (input.school || '').trim().toLowerCase();
  const conference = (input.conference || '').trim().toLowerCase();

  if (!SPORTS.includes(sport)) {
    return { error: `sport must be one of: ${SPORTS.join(', ')}` };
  }

  let rows = nilData[sport] || [];

  if (conference) {
    rows = rows.filter(r => r.conference.toLowerCase().startsWith(conference));
  }

  if (school) {
    const exact = rows.filter(r => r.school.toLowerCase() === school);
    const partial = rows.filter(r => r.school.toLowerCase().includes(school));
    rows = exact.length ? exact : partial;
  }

  if (rows.length === 0) {
    return { error: 'No matching team found in the tracked dataset for that sport/school/conference combination.' };
  }

  // If a broad query (no specific school) returns many rows, cap and sort by NIL desc
  // so "highest paid" / "top spenders" style questions get a useful summary.
  const sorted = [...rows].sort((a, b) => b.nil - a.nil);
  const capped = sorted.slice(0, 25).map(r => ({
    school: r.school,
    conference: r.conference,
    record: r.record,
    conf_record: r.conf_record,
    conf_finish: r.conf_finish,
    postseason: r.postseason,
    team_nil_estimate: r.nil,
    team_nil_display: fmtMoney(r.nil),
    top_player: r.top_player || null,
    top_player_position: r.top_player_pos || null,
    top_player_class: r.top_player_class || null,
    top_player_nil_estimate: r.top_player_nil || null,
    top_player_nil_display: r.top_player_nil ? fmtMoney(r.top_player_nil) : null,
  }));

  return {
    sport,
    season: '2025-26',
    matches_returned: capped.length,
    total_matches: rows.length,
    note: rows.length > 25 ? 'Result truncated to top 25 by NIL spend — ask a narrower question for more detail.' : undefined,
    teams: capped,
  };
}

function toolProjectWinPct(input) {
  const sport = (input.sport || '').toLowerCase();
  const nilSpend = Number(input.nil_spend);

  if (!SPORTS.includes(sport)) {
    return { error: `sport must be one of: ${SPORTS.join(', ')}` };
  }
  if (!Number.isFinite(nilSpend) || nilSpend < 0) {
    return { error: 'nil_spend must be a non-negative number in USD.' };
  }

  const reg = REGRESSION[sport];
  const raw = reg.slope * nilSpend + reg.intercept;
  const projected = Math.min(100, Math.max(0, raw));

  return {
    sport,
    nil_spend_input: nilSpend,
    nil_spend_display: fmtMoney(nilSpend),
    projected_win_pct: Math.round(projected * 10) / 10,
    correlation_r: reg.r,
    r_squared: Math.round(reg.r * reg.r * 1000) / 1000,
    caveat: `This is a linear-regression estimate built from this season's real NIL-spend-vs-win% data across ${sport} programs in the NIL Index dataset. Correlation is r=${reg.r} (r²=${Math.round(reg.r * reg.r * 100)}%), meaning NIL spend explains only part of the variance in win rate — coaching, schedule strength, injuries, and roster continuity matter too. Present this as a data-informed estimate, not a guarantee.`,
  };
}

const TOOLS = [
  {
    name: 'lookup_team',
    description:
      "Look up a school's current-season (2025-26) record, conference, NIL spend estimate, and (for football/basketball only) top-player NIL estimate from the NIL Index's own tracked dataset. Use this for any question about a specific team's record, standing, NIL spend, or top-paid player, or for 'top spenders in [conference]' style questions. Covers football, basketball, baseball, and volleyball only.",
    input_schema: {
      type: 'object',
      properties: {
        sport: { type: 'string', enum: SPORTS, description: 'Which tracked sport to search.' },
        school: { type: 'string', description: 'School name to search for (partial match ok), e.g. "Alabama". Omit to browse/sort a whole sport or conference.' },
        conference: { type: 'string', description: 'Optional conference filter, e.g. "SEC", "Big Ten".' },
      },
      required: ['sport'],
    },
  },
  {
    name: 'project_win_pct',
    description:
      'Project a win percentage for a program given a hypothetical or real NIL spend amount, using a real linear regression fit to this season\'s actual NIL-spend-vs-win% data for that sport. Use this whenever the user asks "what would our win rate look like if we spent $X" or similar hypothetical projections.',
    input_schema: {
      type: 'object',
      properties: {
        sport: { type: 'string', enum: SPORTS, description: 'Which sport to project for.' },
        nil_spend: { type: 'number', description: 'Team NIL spend in US dollars, e.g. 15000000 for $15M.' },
      },
      required: ['sport', 'nil_spend'],
    },
  },
  { type: 'web_search_20260209', name: 'web_search' },
];

function executeLocalTool(name, input) {
  if (name === 'lookup_team') return toolLookupTeam(input);
  if (name === 'project_win_pct') return toolProjectWinPct(input);
  return { error: `Unknown tool: ${name}` };
}

function buildSystemPrompt() {
  const today = new Date();
  const todayDisplay = today.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  return `You are the NIL Index AI Assistant — a college sports information assistant embedded in the NIL Index website. Your goal is to help fans learn about their teams: records, NIL spending, top players, how NIL spend correlates with winning, and general college sports news and history.

Today's real-world date is ${todayDisplay}. Treat this as ground truth, overriding any assumption from your training data about what "current" means. When you use web_search, actively prefer the most recently published/dated results over older ones, and do not present outdated (e.g., prior-year) news, rosters, or figures as current just because they rank well in search — check publish dates and call out when something might be stale. If a user asks for "current" or "latest" info, only cite sources dated at or near today's date above; if the freshest thing you can find is older, say so explicitly instead of presenting it as up to date.

Grounding rules:
- The NIL Index tracks its own dataset for football, basketball, baseball, and volleyball for the current (2025-26) season: team record, conference, and a team NIL spend estimate; for football and basketball only, it also tracks one "top NIL earner" per team (name, position, class, NIL estimate). Use the lookup_team tool for any question that could be answered from this internal dataset — it's more precise than your general knowledge for these specific figures.
- Use the project_win_pct tool whenever someone asks you to project or estimate a win percentage/win total from an NIL spend figure (real or hypothetical). Always pass along the r/r² caveat from the tool result in your answer, in plain language — this is a real statistical correlation, not a guarantee.
- Use the web_search tool for anything current or outside the local dataset: breaking news, transfers, injuries, coaching changes, live scores, rosters, any sport not in the four tracked above, or specific player stats the local dataset doesn't cover. Always prefer a fresh web search over relying on your training knowledge when the answer could be stale — sports rosters and NIL deals change constantly. Cite the source by name when you use web search results (e.g., "per On3...").
- Default to the most current information available. Only lean on older/historical data when the user specifically asks about a past season or era.
- For historical/pre-NIL-era questions ("what would [player] have made in NIL"), use web search or your knowledge to establish real historical context (their actual stats, honors, team success, era), then reason through a labeled hypothetical, inflation- and market-adjusted estimate. Always clearly flag these as estimates, not real figures — never state a fabricated dollar amount as if it were verified fact.
- If you don't know something and search doesn't resolve it, say so plainly rather than guessing.

Tone: concise, conversational, and useful for a casual fan — not a research report. Use short paragraphs or brief bullet points. Only go deep when the question calls for it.`;
}

// ---------- Chat endpoint ----------

app.post('/api/chat', async (req, res) => {
  try {
    const { messages } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    // Keep payload sane: cap history and content length client-side already,
    // but defensively trim here too.
    let conversation = messages.slice(-30).map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content || '').slice(0, 8000),
    }));

    let finalText = null;
    const maxIterations = 8;

    for (let i = 0; i < maxIterations; i++) {
      const response = await client.messages.create({
        model: 'claude-opus-4-6',
        max_tokens: 4096,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        system: buildSystemPrompt(),
        tools: TOOLS,
        messages: conversation,
      });

      if (response.stop_reason === 'pause_turn') {
        // Server-side tool (web_search) hit its internal iteration limit; resend to continue.
        conversation = [...conversation, { role: 'assistant', content: response.content }];
        continue;
      }

      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');

      if (toolUseBlocks.length === 0 || response.stop_reason === 'end_turn') {
        finalText = response.content
          .filter(b => b.type === 'text')
          .map(b => b.text)
          .join('\n\n');
        break;
      }

      // Only our two local tools need client-side execution; web_search runs server-side.
      const localToolUses = toolUseBlocks.filter(b => b.name === 'lookup_team' || b.name === 'project_win_pct');

      if (localToolUses.length === 0) {
        // Nothing for us to execute (shouldn't normally happen if stop_reason isn't end_turn/pause_turn)
        finalText = response.content
          .filter(b => b.type === 'text')
          .map(b => b.text)
          .join('\n\n');
        break;
      }

      conversation = [...conversation, { role: 'assistant', content: response.content }];

      const toolResults = localToolUses.map(block => ({
        type: 'tool_result',
        tool_use_id: block.id,
        content: JSON.stringify(executeLocalTool(block.name, block.input)),
      }));

      conversation = [...conversation, { role: 'user', content: toolResults }];
    }

    if (finalText === null) {
      finalText = "I wasn't able to finish that one — try rephrasing or asking something more specific.";
    }

    res.json({ reply: finalText });
  } catch (err) {
    console.error('[/api/chat] error:', err);
    const status = err && err.status ? err.status : 500;
    const message =
      status === 401
        ? 'The server\'s Anthropic API key is missing or invalid. Check your .env file.'
        : 'Something went wrong talking to the AI. Please try again.';
    res.status(status).json({ error: message });
  }
});

app.listen(PORT, () => {
  console.log(`NIL Index server running at http://localhost:${PORT}`);
});
