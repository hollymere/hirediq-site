const https = require('https');

function callClaude(API_KEY, prompt, maxTokens) {
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
            resolve({ ok: false, error: 'API error ' + res.statusCode + ': ' + data.substring(0, 300) });
            return;
          }
          const parsed = JSON.parse(data);
          let raw = parsed.content[0].text.trim();
          raw = raw.replace(/^```json\n?/, '').replace(/^```\n?/, '').replace(/\n?```$/, '').trim();
          raw = raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
          raw = raw.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[\u2013\u2014]/g, '-');
          JSON.parse(raw); // validate
          resolve({ ok: true, body: raw });
        } catch(err) {
          resolve({ ok: false, error: 'Parse error: ' + err.message });
        }
      });
    });

    req.on('error', (err) => {
      resolve({ ok: false, error: 'Request error: ' + err.message });
    });

    req.write(requestBody);
    req.end();
  });
}

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

  // ── MODE: cover_letter ──────────────────────────────────────────────────
  if (mode === 'cover_letter') {
    const prompt = `You are HiredIQ. Write a tailored cover letter for this candidate applying for this specific role.

Use only standard ASCII characters - no smart quotes, no em dashes, no special characters.

Respond ONLY with valid JSON in exactly this structure:
{
  "cover_letter": "<full professional cover letter, specific to this role and company, 3-4 paragraphs, not generic>"
}

JOB DESCRIPTION:
${jobDesc}

CANDIDATE CV:
${cvContent}

Respond with valid JSON only. No markdown, no code blocks, no other text.`;

    const result = await callClaude(API_KEY, prompt, 1500);
    if (!result.ok) {
      return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: result.error }) };
    }
    return { statusCode: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: result.body };
  }

  // ── MODE: rewrite ───────────────────────────────────────────────────────
  if (mode === 'rewrite') {
    const prompt = `You are HiredIQ. Rewrite this candidate's CV for this specific role and generate screening questions.

Use only standard ASCII characters - no smart quotes, no em dashes, no special characters.

Respond ONLY with valid JSON in exactly this structure:
{
  "ats_optimised_cv": "<full plain text ATS-optimised CV. Incorporate missing keywords naturally. Use only these section headers: Professional Summary, Work Experience, Education, Skills, Achievements. No tables, no columns, no special bullet symbols.>",
  "cv_rewrite": "<full polished human-readable CV tailored for this specific role. Same content as ATS version but written to impress a human hiring manager.>",
  "screening_questions": [
    {
      "question": "<specific question a recruiter would ask based on this role and CV>",
      "why_asked": "<one sentence on why recruiters ask this>",
      "answer_framework": "<specific guidance on what to cover, what to emphasise, how to address any weakness>"
    }
  ]
}

Generate exactly 5 screening questions specific to this role and CV gaps. Not generic interview questions.

JOB DESCRIPTION:
${jobDesc}

CANDIDATE CV:
${cvContent}

Respond with valid JSON only. No markdown, no code blocks, no other text.`;

    const result = await callClaude(API_KEY, prompt, 3000);
    if (!result.ok) {
      return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: result.error }) };
    }
    return { statusCode: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: result.body };
  }

  // ── MODE: analyse (default) ─────────────────────────────────────────────
  const prompt = `You are HiredIQ, an honest CV assessment tool built by a former MD with 30 years of hiring experience. Give candidates the complete honest truth. Do not flatter or inflate scores.

Use only standard ASCII characters - no smart quotes, no em dashes, no special characters.

Respond ONLY with valid JSON in exactly this structure:
{
  "score": <number 0-100>,
  "verdict": "<one of: Strong Candidate, Borderline, Do Not Apply>",
  "summary": "<2-3 sentences of honest plain English assessment. Be direct and specific.>",
  "requirements_met": [
    {"requirement": "<requirement text>", "evidence": "<specific evidence from the CV>"}
  ],
  "requirements_missing": [
    {"requirement": "<requirement text>", "reason": "<why this gap matters to this employer>"}
  ],
  "ats_keywords_present": [
    "<exact keyword or phrase from job description that IS present in the CV>"
  ],
  "ats_keywords_missing": [
    "<exact keyword or phrase from job description that is NOT in the CV but should be>"
  ],
  "ats_warnings": [
    "<any formatting issue that could cause ATS rejection>"
  ],
  "salary_context": "<one sentence on what this role typically pays at this level in this location>",
  "salary_range_low": "<lower salary figure with currency symbol>",
  "salary_range_high": "<upper salary figure with currency symbol>"
}

Scoring guide: below 40 = Do Not Apply. 40-65 = Borderline. Above 65 = Strong Candidate.

JOB DESCRIPTION:
${jobDesc}

CANDIDATE CV:
${cvContent}

Respond with valid JSON only. No markdown, no code blocks, no other text.`;

  const result = await callClaude(API_KEY, prompt, 3500);
  if (!result.ok) {
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: result.error }) };
  }
  return { statusCode: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: result.body };
};
