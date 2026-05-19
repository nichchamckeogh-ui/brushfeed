// feed.js — reads pre-built JSON from Vercel Blob, serves to app
// Zero NewsAPI calls. Zero Claude calls. Just reads a file.

const BLOB_BASE_URL = process.env.BLOB_BASE_URL; // set in Vercel env vars

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const topics = (req.query.topics || 'AI,Parenting').split(',');

  try {
    const allCards = [];
    const meta = {};

    // Read each topic's JSON file from Vercel Blob in parallel
    const readPromises = topics.map(async topic => {
      try {
        const url = `${BLOB_BASE_URL}/cards_${topic}.json`;
        const blobRes = await fetch(url);
        if (!blobRes.ok) {
          console.error(`Could not read cards_${topic}.json`);
          return;
        }
        const data = await blobRes.json();
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

    // Shuffle cards so topics are interleaved
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
