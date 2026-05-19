// feed.js — reads pre-built JSON from GitHub, serves to app
// Zero NewsAPI calls. Zero Claude calls. Just reads a file.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const topics = (req.query.topics || 'AI,Parenting').split(',');
  const GITHUB_REPO = process.env.GITHUB_REPO;

  try {
    const allCards = [];
    const meta = {};

    // Read each topic's JSON file from GitHub raw URL in parallel
    const readPromises = topics.map(async topic => {
      try {
        const url = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/public/cards_${topic}.json`;
        const githubRes = await fetch(url, {
          headers: { 'Cache-Control': 'no-cache' },
        });

        if (!githubRes.ok) {
          console.error(`Could not read cards_${topic}.json from GitHub (${githubRes.status})`);
          return;
        }

        const data = await githubRes.json();
        if (data.cards && Array.isArray(data.cards)) {
          allCards.push(...data.cards);
          meta[topic] = {
            generatedAt: data.generatedAt,
            cardCount: data.cardCount,
          };
        }
      } catch (e) {
        console.error(`Error reading ${topic}:`, e.message);
      }
    });

    await Promise.all(readPromises);

    if (allCards.length === 0) {
      return res.status(503).json({
        error: 'Feed not ready yet. The cron job may not have run yet. Please try again in a few minutes.',
      });
    }

    // Shuffle so topics are interleaved nicely
    for (let i = allCards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allCards[i], allCards[j]] = [allCards[j], allCards[i]];
    }

    return res.status(200).json({
      cards: allCards,
      meta,
      servedAt: new Date().toISOString(),
    });

  } catch (err) {
    console.error('Feed error:', err);
    return res.status(500).json({ error: err.message });
  }
}
