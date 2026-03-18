const router = require('express').Router();
const fetch = require('node-fetch');
const auth = require('../middleware/auth');
const db = require('../db');

router.post('/fetch', auth(), async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY mangler' });

  const today = new Date().toLocaleDateString('da-DK', { day: 'numeric', month: 'long', year: 'numeric' });

  // Get brand + KB context for relevance scoring
  let brandContext = '';
  try {
    const brand = await db.brand.get();
    const kb = await db.knowledge.get();
    const treatments = (kb.treatments || []).slice(0, 10).map(t => t.name).join(', ');
    brandContext = `

VIGTIGT — Vurder hver nyhed ift. CeriX (dansk medspa-klinik):
- Tagline: ${brand.tagline || 'Professionelle æstetiske behandlinger'}
- Tone: ${brand.tone || 'Faglig og varm'}
- Ydelser: ${treatments || 'Botox, fillers, laser, hudpleje, kemisk peeling'}

For HVER nyhed: tilføj "relevance" (1-10 for CeriX) og "angle" (kort forslag til hvordan CeriX kan bruge nyheden i en annonce/nyhedsbrev, max 15 ord). Høj relevans = direkte relevant for CeriX's ydelser eller målgruppe.`;
  } catch {}

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 6000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{
          role: 'user',
          content: `Du er brancheanalytiker for kosmetisk medicin og medspa. Søg og find 25 aktuelle nyheder pr. ${today}.

Kategorier: "global" (international industri), "denmark" (dansk specifik), "regulatory" (Styrelsen for Patientsikkerhed, Sikkerhedsforeningen, EU), "social" (sociale medier trends fra kunder/klinikejere).
${brandContext}

Returnér KUN et JSON-array uden markdown. Hvert objekt: { "title":"(max 12 ord)", "summary":"2-3 sætninger", "category":"global|denmark|regulatory|social", "source":"kildenavn", "tags":["tag1","tag2"], "url":"https://...eller null", "relevance":1-10, "angle":"kort annoncevinkel for CeriX (max 15 ord)" }

25 nyheder som rent JSON-array, sorteret med højeste relevance først.`
        }]
      })
    });
    const data = await response.json();
    if (!data.content || data.error) {
      return res.status(500).json({ error: data.error?.message || 'AI API fejl' });
    }
    const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return res.status(500).json({ error: 'Parse fejl' });
    res.json(JSON.parse(match[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
