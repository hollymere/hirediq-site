const https = require('https');

exports.handler = async function(event, context) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) {
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'API key not configured' }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch(e) { return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Invalid request body' }) }; }

  const { jobDesc, cvContent, mode } = body;
  if (!jobDesc || !cvContent) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Missing job description or CV' }) };
  }

  const jd = jobDesc.substring(0, 3500);
  const cv = cvContent.substring(0, 4000);

  function makeRequest(prompt, maxTokens) {
    const requestBody = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }]
    });

    return new Promise((resolve) => {
      const options = {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(requestBody)
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            if (res.statusCode !== 200) {
              resolve({ statusCode: res.statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'API error ' + res.statusCode + ': ' + data.substring(0, 300) }) });
              return;
            }
            const parsed = JSON.parse(data);
            let raw = parsed.content[0].text.trim();
            raw = raw.replace(/^```json\n?/, '').replace(/^```\n?/, '').replace(/\n?```$/, '').trim();
            raw = raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
            raw = raw.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[\u2013\u2014]/g, '-');
            JSON.parse(raw);
            resolve({ statusCode: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: raw });
          } catch(err) {
            resolve({ statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Parse error: ' + err.message }) });
          }
        });
      });

      req.on('error', (err) => {
        resolve({ statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Request error: ' + err.message }) });
      });

      req.write(requestBody);
      req.end();
    });
  }

  // STEP 2: CV REWRITE - ATS handled invisibly, clean output
  if (mode === 'rewrite') {
    const prompt = `You are HiredIQ, built by a former MD with 30 years hiring experience. Rewrite this CV to be genuinely competitive for this specific role. ASCII only, no smart quotes or em dashes.

Rules for the rewrite:
- Professional Summary: 3-4 sentences. You MUST open with the exact job title from the job description - not the candidate's current job title. Focus entirely on what THIS employer needs. Reference the most relevant experience from the candidate's background that matches THIS role specifically. Do not describe their current role if it is less relevant than a previous role.
- Work Experience: For each role, start with one punchy line summarising what that role delivered overall (e.g. "Drove 12% revenue growth leading a team of 5 across utilities sector accounts."). Then write 4-5 bullet points. Every bullet must show an ACHIEVEMENT not a duty. Use numbers, values, percentages and scale wherever the CV provides evidence. Start each bullet with a strong action verb. Give more detail and more bullets to roles most relevant to this specific job description.
- Skills: Maximum 10 skills. Only include skills directly relevant to this role. Use exact terminology from the job description.
- Education: Keep concise but include context.
- Incorporate every missing keyword from the job description naturally throughout.
- The result must read like it was written by the candidate specifically for this role.

Respond ONLY with this JSON:
{
  "ats_optimised_cv": "<full rewritten CV. Use these headers only: Professional Summary, Work Experience, Education, Skills. Make it compelling, specific and achievement-led.>"
}
JOB: ${jd}
CV: ${cv}
JSON only. No markdown, no code blocks.`;
    return makeRequest(prompt, 2500);
  }

  // STEP 1: ANALYSE - score, verdict, requirements, salary only
  const prompt = `You are HiredIQ, built by a former MD with 30 years hiring experience. Be brutally honest. Do not inflate scores. ASCII only, no smart quotes or em dashes.

Score bands:
75-100 = Strong Candidate: genuinely competitive for this role
55-74 = Good Match: worth applying, some gaps but strong overall
40-54 = Borderline: significant gaps, apply only if prepared to address them
0-39 = Do Not Apply: not enough match, time better spent elsewhere

Respond ONLY with this JSON:
{
  "score": <0-100>,
  "verdict": "<Strong Candidate|Good Match|Borderline|Do Not Apply>",
  "summary": "<2-3 sentences of honest plain English assessment. Be direct and specific.>",
  "requirements_met": [{"requirement": "<text>", "evidence": "<specific evidence from CV>"}],
  "requirements_missing": [{"requirement": "<text>", "reason": "<why this gap matters to this employer>"}],
  "salary_context": "<one sentence on typical pay for this role at this level in this location>",
  "salary_range_low": "<figure with currency symbol>",
  "salary_range_high": "<figure with currency symbol>"
}

JOB: ${jd}
CV: ${cv}
JSON only. No markdown, no code blocks.`;

  return makeRequest(prompt, 1500);
};
