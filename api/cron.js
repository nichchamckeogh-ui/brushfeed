// cron.js — runs twice daily, fetches RSS, calls Claude, saves to GitHub

// ── RSS SOURCES ───────────────────────────────────────────────────────────────
const SOURCES = {
  AI: [
    { name: 'TechCrunch', url: 'https://techcrunch.com/category/artificial-intelligence/feed/' },
    { name: 'MIT Technology Review', url: 'https://www.technologyreview.com/feed/' },
    { name: 'The Verge', url: 'https://www.theverge.com/ai-artificial-intelligence/rss/index.xml' },
    { name: 'VentureBeat', url: 'https://venturebeat.com/category/ai/feed/' },
  ],
  Parenting: [
    { name: 'The Guardian', url: 'https://www.theguardian.com/lifeandstyle/family/rss' },
    { name: 'Psychology Today', url: 'https://www.psychologytoday.com/us/front/feed' },
    { name: 'BBC News', url: 'https://feeds.bbci.co.uk/news/rss.xml' },
  ],
};

// ── XML PARSER ────────────────────────────────────────────────────────────────
function parseRSS(xml, sourceName) {
  const items = [];
  const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);
  for (const match of itemMatches) {
    const item = match[1];
    const title = extractTag(item, 'title');
    const description = extractTag(item, 'description');
    const pubDate = extractTag(item, 'pubDate');
    if (title && description) {
      items.push({
        title: cleanText(title),
        description: cleanText(description).slice(0, 300),
        publishedAt: pubDate ? formatDate(pubDate) : '',
        source: sourceName,
      });
    }
  }
  return items;
}

function extractTag(xml, tag) {
  const match = xml.match(
    new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\/${tag}>`)
  );
  if (!match) return '';
  return (match[1] || match[2] || '').trim();
}

function cleanText(text) {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatDate(dateStr) {
  try { return new Date(dateStr).toISOString().split('T')[0]; }
  catch { return ''; }
}

// ── FETCH RSS ─────────────────────────────────────────────────────────────────
async function fetchRSS(source) {
  try {
    const res = await fetch(source.url, {
      headers: { 'User-Agent': 'BrushFeed/1.0 RSS Reader' },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseRSS(xml, source.name).slice(0, 25);
  } catch (e) {
    console.error(`RSS fetch failed for ${source.name}:`, e.message);
    return [];
  }
}

// ── CLAUDE: FILTER + SUMMARISE ────────────────────────────────────────────────
async function processWithClaude(topic, articles, apiKey) {
  const topicRules = {
    AI: 'artificial intelligence, machine learning, AI models, ChatGPT, OpenAI, Google AI, robotics, AI regulation, AI safety, large language models. Reject: general tech not specifically about AI, politics, sports, celebrity.',
    Parenting: 'parenting advice, child development, babies, toddlers, kids education, screen time, child psychology, family health, teenage wellbeing. Reject: general education policy, celebrity families, unrelated news.',
  };

  const articleList = articles
    .map((a, i) => `${i + 1}. "${a.title}" — ${a.description} (${a.source}, ${a.publishedAt})`)
    .join('\n');

  const prompt = `You are BrushFeed's editorial AI for the topic: ${topic}

Topic: ${topicRules[topic]}

${articles.length} articles to evaluate:
${articleList}

Instructions:
- Keep ONLY articles genuinely about ${topic}
- Reject anything off-topic
- Write a clean 3-sentence card for each kept article
- Do NOT generate any cards — only use real articles above
- Return fewer cards if not enough relevant articles — do not pad with irrelevant content

Return JSON array ONLY. Start with [ end with ]. No other text.

Format: [{"title":"Under 9 words","body":"3 sentences with specific facts.","source":"Publication","publishedAt":"2026-05-19"}]`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4000,
      system: 'You are a strict editorial AI and JSON generator. Respond with only a valid JSON array. No markdown, no backticks, no preamble. Start with [ and end with ].',
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || 'Claude error');

  const text = data.content?.map(b => b.text || '').join('') || '';

  let cards = null;
  try { cards = JSON.parse(text.trim()); } catch {}
  if (!cards) {
    const match = text.match(/\[[\s\S]*\]/);
    if (match) try { cards = JSON.parse(match[0]); } catch {}
  }
  if (!cards || !Array.isArray(cards)) return [];

  return cards.map(c => ({ ...c, topic }));
}

// ── SAVE TO GITHUB ────────────────────────────────────────────────────────────
async function saveToGitHub(filename, content, token, repo) {
  const apiUrl = `https://api.github.com/repos/${repo}/contents/public/${filename}`;

  // Check if file already exists to get its SHA (needed for updates)
  let sha = null;
  try {
    const check = await fetch(apiUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });
    if (check.ok) {
      const existing = await check.json();
      sha = existing.sha;
    }
  } catch {}

  // Create or update the file
  const body = {
    message: `Update ${filename} — ${new Date().toISOString()}`,
    content: Buffer.from(JSON.stringify(content, null, 2)).toString('base64'),
    ...(sha ? { sha } : {}),
  };

  const res = await fetch(apiUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(`GitHub save failed: ${err.message}`);
  }

  return `https://raw.githubusercontent.com/${repo}/main/public/${filename}`;
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const GITHUB_REPO = process.env.GITHUB_REPO;

  const activeTopics = ['AI', 'Parenting'];
  const results = {};

  try {
    for (const topic of activeTopics) {
      console.log(`\nProcessing: ${topic}`);

      // Fetch all RSS sources in parallel
      const fetchPromises = SOURCES[topic].map(s => fetchRSS(s));
      const fetchResults = await Promise.all(fetchPromises);
      const allArticles = fetchResults.flat();
      console.log(`${topic}: ${allArticles.length} articles fetched`);

      if (allArticles.length === 0) {
        results[topic] = { error: 'No articles from RSS' };
        continue;
      }

      // One Claude call per topic
      const cards = await processWithClaude(topic, allArticles, ANTHROPIC_API_KEY);
      console.log(`${topic}: ${cards.length} cards generated`);

      // Save to GitHub
      const payload = {
        topic,
        generatedAt: new Date().toISOString(),
        cardCount: cards.length,
        cards,
      };

      const url = await saveToGitHub(`cards_${topic}.json`, payload, GITHUB_TOKEN, GITHUB_REPO);
      console.log(`${topic}: saved to ${url}`);

      results[topic] = { success: true, cardCount: cards.length, url };
    }

    return res.status(200).json({
      success: true,
      generatedAt: new Date().toISOString(),
      results,
    });

  } catch (err) {
    console.error('Cron error:', err);
    return res.status(500).json({ error: err.message });
  }
}
