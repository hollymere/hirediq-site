const https = require('https');

exports.handler = async function(event, context) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch(e) { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request' }) }; }

  const { email } = body;
  if (!email) { return { statusCode: 400, body: JSON.stringify({ error: 'Email required' }) }; }

  // Mailchimp API details
  const API_KEY = process.env.MAILCHIMP_API_KEY;
  const DC = 'us19';
  
  // Get audience ID - we'll use the default audience
  const listData = JSON.stringify({
    email_address: email,
    status: 'subscribed',
    tags: ['hirediq-free-user'],
    merge_fields: {
      SOURCE: 'HiredIQ Analyser'
    }
  });

  return new Promise((resolve) => {
    // First get the list ID
    const listOptions = {
      hostname: `${DC}.api.mailchimp.com`,
      path: '/3.0/lists',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      }
    };

    const listReq = https.request(listOptions, (listRes) => {
      let listData_raw = '';
      listRes.on('data', chunk => { listData_raw += chunk; });
      listRes.on('end', () => {
        try {
          const lists = JSON.parse(listData_raw);
          const listId = lists.lists && lists.lists[0] ? lists.lists[0].id : null;
          
          if (!listId) {
            resolve({ statusCode: 200, body: JSON.stringify({ success: true, note: 'No list found' }) });
            return;
          }

          // Add member to list
          const memberOptions = {
            hostname: `${DC}.api.mailchimp.com`,
            path: `/3.0/lists/${listId}/members`,
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${API_KEY}`,
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(listData)
            }
          };

          const memberReq = https.request(memberOptions, (memberRes) => {
            let memberData = '';
            memberRes.on('data', chunk => { memberData += chunk; });
            memberRes.on('end', () => {
              resolve({
                statusCode: 200,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                body: JSON.stringify({ success: true })
              });
            });
          });

          memberReq.on('error', (err) => {
            resolve({ statusCode: 200, body: JSON.stringify({ success: true, note: err.message }) });
          });

          memberReq.write(listData);
          memberReq.end();

        } catch(e) {
          resolve({ statusCode: 200, body: JSON.stringify({ success: true }) });
        }
      });
    });

    listReq.on('error', (err) => {
      resolve({ statusCode: 200, body: JSON.stringify({ success: true }) });
    });

    listReq.end();
  });
};
