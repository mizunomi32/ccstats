import {
  COST_PER_INPUT_TOKEN,
  COST_PER_OUTPUT_TOKEN,
  COST_PER_CACHE_TOKEN,
} from "../lib/constants";

export function renderDashboard(): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ccstats - Claude Code Usage Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
  <style>
    :root {
      --bg: #0f172a;
      --surface: #1e293b;
      --border: #334155;
      --text: #e2e8f0;
      --text-muted: #94a3b8;
      --accent: #818cf8;
      --accent2: #34d399;
      --accent3: #fb923c;
      --danger: #f87171;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
    }
    .container { max-width: 1200px; margin: 0 auto; padding: 24px; }
    h1 { font-size: 1.5rem; margin-bottom: 24px; }
    h1 span { color: var(--accent); }

    /* フィルター */
    .filters {
      display: flex; gap: 8px; margin-bottom: 24px; flex-wrap: wrap;
    }
    .filters button {
      padding: 6px 16px; border: 1px solid var(--border); border-radius: 6px;
      background: var(--surface); color: var(--text); cursor: pointer;
      font-size: 0.875rem; transition: all 0.15s;
    }
    .filters button.active, .filters button:hover {
      border-color: var(--accent); background: rgba(129,140,248,0.15);
    }

    /* カード */
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px; margin-bottom: 24px;
    }
    .card {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 10px; padding: 20px;
    }
    .card-label { font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
    .card-value { font-size: 1.75rem; font-weight: 700; margin-top: 4px; }
    .card-sub { font-size: 0.8rem; color: var(--text-muted); margin-top: 2px; }

    /* グラフ */
    .charts {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(500px, 1fr));
      gap: 16px; margin-bottom: 24px;
    }
    .chart-box {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 10px; padding: 20px;
    }
    .chart-box h3 { font-size: 0.9rem; margin-bottom: 12px; color: var(--text-muted); }
    .chart-box canvas { max-height: 300px; }

    /* テーブル */
    .table-box {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 10px; padding: 20px; overflow-x: auto;
    }
    .table-box h3 { font-size: 0.9rem; margin-bottom: 12px; color: var(--text-muted); }
    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    th { text-align: left; padding: 8px; border-bottom: 1px solid var(--border); color: var(--text-muted); font-weight: 500; }
    td { padding: 8px; border-bottom: 1px solid var(--border); }
    tr:last-child td { border-bottom: none; }

    .loading { text-align: center; padding: 40px; color: var(--text-muted); }

    @media (max-width: 600px) {
      .charts { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="container">
    <h1><span>ccstats</span> Dashboard</h1>

    <div class="filters">
      <button data-range="1" class="active">Today</button>
      <button data-range="7">7 Days</button>
      <button data-range="30">30 Days</button>
      <button data-range="90">90 Days</button>
    </div>

    <div class="cards" id="cards">
      <div class="loading">Loading...</div>
    </div>

    <div class="charts">
      <div class="chart-box">
        <h3>Token Usage</h3>
        <canvas id="tokenChart"></canvas>
      </div>
      <div class="chart-box">
        <h3>Top Tools</h3>
        <canvas id="toolChart"></canvas>
      </div>
    </div>

    <div class="charts">
      <div class="chart-box">
        <h3>Agents &amp; Skills</h3>
        <canvas id="agentChart"></canvas>
      </div>
    </div>

    <div class="table-box">
      <h3>Recent Sessions</h3>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Project</th>
            <th>Branch</th>
            <th>Model</th>
            <th>Tokens</th>
            <th>Cost</th>
            <th>Duration</th>
          </tr>
        </thead>
        <tbody id="sessionsBody">
          <tr><td colspan="7" class="loading">Loading...</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <script>
    const COST = {
      input: ${COST_PER_INPUT_TOKEN},
      output: ${COST_PER_OUTPUT_TOKEN},
      cache: ${COST_PER_CACHE_TOKEN},
    };

    let tokenChart, toolChart, agentChart;
    let currentRange = 1;

    function isAgentOrSkill(name) {
      return name.startsWith('Agent:') || name.startsWith('Skill:') || name.startsWith('mcp__');
    }

    function dateRange(days) {
      const to = new Date().toISOString();
      const from = new Date(Date.now() - days * 86400000).toISOString();
      return { from, to };
    }

    function fmt(n) {
      if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
      if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
      return n.toString();
    }

    function cost(inp, out, cache) {
      return (inp * COST.input + out * COST.output + cache * COST.cache).toFixed(2);
    }

    function duration(sec) {
      if (!sec) return '-';
      if (sec < 60) return sec + 's';
      return Math.floor(sec / 60) + 'm ' + (sec % 60) + 's';
    }

    function projectName(cwd) {
      return cwd.split('/').filter(Boolean).pop() || cwd;
    }

    function esc(s) {
      if (s == null) return '';
      const d = document.createElement('div');
      d.textContent = String(s);
      return d.innerHTML;
    }

    async function fetchJSON(path) {
      const res = await fetch(path);
      if (!res.ok) throw new Error('API error: ' + res.status);
      return res.json();
    }

    async function loadData(days) {
      currentRange = days;
      const { from, to } = dateRange(days);
      const q = 'from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to);

      let summary, tokens, tools, sessions;
      try {
        [summary, tokens, tools, sessions] = await Promise.all([
        fetchJSON('/api/stats/summary?' + q),
        fetchJSON('/api/stats/tokens?' + q + '&granularity=daily'),
        fetchJSON('/api/stats/tools?' + q),
        fetchJSON('/api/sessions?' + q + '&limit=20'),
      ]);
      } catch (e) {
        document.getElementById('cards').innerHTML =
          '<div class="card" style="grid-column:1/-1;text-align:center;color:var(--danger)">Failed to load data: ' + esc(e.message) + '</div>';
        return;
      }

      // Cards
      const totalTokens = summary.total_input_tokens + summary.total_output_tokens;
      const totalCost = cost(summary.total_input_tokens, summary.total_output_tokens, summary.total_cache_read_tokens);
      const cacheRate = (summary.total_input_tokens + summary.total_cache_read_tokens) > 0
        ? Math.round(summary.total_cache_read_tokens / (summary.total_input_tokens + summary.total_cache_read_tokens) * 100)
        : 0;

      document.getElementById('cards').innerHTML =
        card('Sessions', summary.total_sessions, '') +
        card('Total Tokens', fmt(totalTokens), 'In: ' + fmt(summary.total_input_tokens) + ' / Out: ' + fmt(summary.total_output_tokens)) +
        card('Est. Cost', '$' + totalCost, '') +
        card('Avg Duration', duration(summary.avg_duration_per_session), 'per session') +
        card('Cache Rate', cacheRate + '%', fmt(summary.total_cache_read_tokens) + ' tokens');

      // Token Chart
      renderTokenChart(tokens.data);

      // Tool Chart (基本ツールのみ: Agent/Skill/MCP を除外)
      const basicTools = tools.tools.filter(t => !isAgentOrSkill(t.tool_name)).slice(0, 10);
      renderToolChart(basicTools);

      // Agents & Skills Chart
      const agentTools = tools.tools.filter(t => isAgentOrSkill(t.tool_name));
      renderAgentChart(agentTools);

      // Sessions Table
      const tbody = document.getElementById('sessionsBody');
      if (sessions.sessions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted)">No data</td></tr>';
        return;
      }
      tbody.innerHTML = sessions.sessions.map(s => {
        const d = new Date(s.started_at);
        const dateStr = d.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        return '<tr>' +
          '<td>' + esc(dateStr) + '</td>' +
          '<td>' + esc(projectName(s.cwd)) + '</td>' +
          '<td>' + esc(s.git_branch || '-') + '</td>' +
          '<td>' + esc(s.model || '-') + '</td>' +
          '<td>' + esc(fmt(s.total_tokens)) + '</td>' +
          '<td>$' + esc(cost(s.input_tokens, s.output_tokens, s.cache_read_tokens)) + '</td>' +
          '<td>' + esc(duration(s.duration_seconds)) + '</td>' +
          '</tr>';
      }).join('');
    }

    function card(label, value, sub) {
      return '<div class="card"><div class="card-label">' + label + '</div><div class="card-value">' + value + '</div>' +
        (sub ? '<div class="card-sub">' + sub + '</div>' : '') + '</div>';
    }

    function renderTokenChart(data) {
      const ctx = document.getElementById('tokenChart');
      if (tokenChart) tokenChart.destroy();
      tokenChart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: data.map(d => d.period),
          datasets: [
            { label: 'Input', data: data.map(d => d.input_tokens), backgroundColor: '#818cf8', stack: 'a' },
            { label: 'Output', data: data.map(d => d.output_tokens), backgroundColor: '#34d399', stack: 'a' },
            { label: 'Cache', data: data.map(d => d.cache_read_tokens), backgroundColor: '#fb923c', stack: 'a' },
          ],
        },
        options: {
          responsive: true,
          plugins: { legend: { labels: { color: '#94a3b8' } } },
          scales: {
            x: { stacked: true, ticks: { color: '#94a3b8' }, grid: { color: '#1e293b' } },
            y: { stacked: true, ticks: { color: '#94a3b8' }, grid: { color: '#334155' } },
          },
        },
      });
    }

    function renderToolChart(tools) {
      const ctx = document.getElementById('toolChart');
      if (toolChart) toolChart.destroy();
      toolChart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: tools.map(t => t.tool_name),
          datasets: [{
            label: 'Calls',
            data: tools.map(t => t.total_calls),
            backgroundColor: '#818cf8',
          }],
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { color: '#94a3b8' }, grid: { color: '#334155' } },
            y: { ticks: { color: '#94a3b8' }, grid: { display: false } },
          },
        },
      });
    }

    function renderAgentChart(tools) {
      const ctx = document.getElementById('agentChart');
      if (agentChart) agentChart.destroy();
      if (tools.length === 0) {
        ctx.parentElement.style.display = 'none';
        return;
      }
      ctx.parentElement.style.display = '';
      agentChart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: tools.map(t => t.tool_name),
          datasets: [{
            label: 'Calls',
            data: tools.map(t => t.total_calls),
            backgroundColor: '#34d399',
          }],
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { color: '#94a3b8' }, grid: { color: '#334155' } },
            y: { ticks: { color: '#94a3b8' }, grid: { display: false } },
          },
        },
      });
    }

    // Filter buttons
    document.querySelectorAll('.filters button').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filters button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        loadData(Number(btn.dataset.range));
      });
    });

    // Initial load
    loadData(1);
  </script>
</body>
</html>`;
}
