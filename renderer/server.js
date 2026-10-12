const http = require('http');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

let puppeteer;
try {
  puppeteer = require('puppeteer');
} catch (e) {
  console.error('Puppeteer not installed.');
  process.exit(1);
}

const PORT = process.env.PORT || 3500;
const SLIDES_DIR = path.join(__dirname, 'slides');
const PUBLIC_DIR = path.join(__dirname, 'public', 'images');

if (!fs.existsSync(PUBLIC_DIR)) {
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
}

function escapeHtml(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getVerdictColors(verdict) {
  const v = (verdict || '').toUpperCase();
  if (v === 'CREDIBLE') return { color: '#38A169', bg: '#F0FFF4' };
  if (v === 'QUESTIONABLE') return { color: '#D69E2E', bg: '#FFF8E7' };
  return { color: '#E53E3E', bg: '#FFF5F5' };
}

function scoreDasharray(score) {
  const circumference = 2 * Math.PI * 232;
  return Math.round((score / 10) * circumference);
}

function fillTemplate(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return vars[key] !== undefined ? vars[key] : '';
  });
}

function buildFlagsHtml(flags) {
  if (!Array.isArray(flags) || flags.length === 0) {
    return '<div class="s4-flag"><div class="s4-num">01</div><div><div class="s4-title">No flags detected</div></div></div>';
  }
  return flags.map((flag, i) => {
    const num = String(i + 1).padStart(2, '0');
    const title = escapeHtml(typeof flag === 'object' ? flag.title || flag.name || '' : String(flag));
    const desc = escapeHtml(typeof flag === 'object' ? flag.description || flag.desc || '' : '');
    return `<div class="s4-flag">
      <div class="s4-num">${num}</div>
      <div><div class="s4-title">${title}</div>${desc ? `<div class="s4-desc">${desc}</div>` : ''}</div>
    </div>`;
  }).join('');
}

function buildSourcesHtml(sources, type) {
  if (!Array.isArray(sources) || sources.length === 0) {
    return `<div class="s5-source"><div class="s5-bar ${type}"></div><div><div class="s5-name">No sources found</div></div></div>`;
  }
  return sources.map(s => {
    const name = escapeHtml(typeof s === 'object' ? s.name || s.outlet || '' : String(s));
    const url = escapeHtml(typeof s === 'object' ? s.url || s.domain || '' : '');
    return `<div class="s5-source">
      <div class="s5-bar ${type}"></div>
      <div><div class="s5-name">${name}</div>${url ? `<div class="s5-url">${url}</div>` : ''}</div>
    </div>`;
  }).join('');
}

async function renderSlide(browser, htmlContent, outputPath) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1350, deviceScaleFactor: 1 });
  await page.setContent(htmlContent, { waitUntil: 'networkidle0', timeout: 15000 });

  const jpgPath = outputPath.replace('.png', '.jpg');
  await page.screenshot({
    path: jpgPath,
    type: 'jpeg',
    quality: 90,
    fullPage: false
  });
  await page.close();

  const tempPath = jpgPath + '.tmp.jpg';
  await sharp(jpgPath)
    .sharpen({ sigma: 1.0, m1: 1.2, m2: 0.7 })
    .toFile(tempPath);
  fs.renameSync(tempPath, jpgPath);
}

async function handleRender(reqBody) {
  const data = JSON.parse(reqBody);

  const verdict = (data.verdict || 'QUESTIONABLE').toUpperCase();
  const verdictDisplay = verdict.charAt(0) + verdict.slice(1).toLowerCase();
  const { color: verdictColor, bg: verdictBg } = getVerdictColors(verdict);
  const score = parseInt(data.score) || 5;
  const dasharray = scoreDasharray(score);
  const flags = data.flags || [];
  const supporting = data.supportingSources || [];
  const opposing = data.opposingSources || [];

  const vars = {
    title: escapeHtml(data.title || ''),
    verdict: escapeHtml(verdictDisplay),
    verdictColor,
    verdictBg,
    score: String(score),
    scoreDasharray: String(dasharray),
    source: escapeHtml(data.source || ''),
    summary: escapeHtml(data.summary || ''),
    reasoning1: escapeHtml(data.reasoning1 || ''),
    reasoning2: escapeHtml(data.reasoning2 || ''),
    finding: escapeHtml(data.finding || ''),
    imageUrl: data.imageUrl || '',
    flagCount: String(flags.length),
    flagPlural: flags.length === 1 ? '' : 'S',
    flagsHtml: buildFlagsHtml(flags),
    supportingSourcesHtml: buildSourcesHtml(supporting, 'green'),
    opposingSourcesHtml: buildSourcesHtml(opposing, 'red'),
    supportingCount: String(supporting.length),
    opposingCount: String(opposing.length),
  };

  const templates = [];
  for (let i = 1; i <= 7; i++) {
    const tplPath = path.join(SLIDES_DIR, `slide${i}.html`);
    const tpl = fs.readFileSync(tplPath, 'utf8');
    templates.push(tpl);
  }

  const batchId = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });

  const imagePaths = [];

  try {
    for (let i = 0; i < 7; i++) {
      const filled = fillTemplate(templates[i], vars);
      const filename = `${batchId}_slide${i + 1}.jpg`;
      const outputPath = path.join(PUBLIC_DIR, filename);
      await renderSlide(browser, filled, outputPath);
      imagePaths.push(`/images/${filename}`);
    }
  } finally {
    await browser.close();
  }

  return { success: true, images: imagePaths, batchId };
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'factcheckly-renderer' }));
    return;
  }

  if (req.method === 'POST' && req.url === '/render') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', async () => {
      try {
        const result = await handleRender(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        console.error('Render error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Factcheckly Renderer listening on port ${PORT}`);
});
