// api/sp-verify-token.js
// Supabase version of token verification - uses service role key

export default async function handler(req, res) {
  const CORS_ORIGIN = 'https://www.turnkii.es';

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method !== "POST") {
    return res.status(405).json({ 
      valid: false, 
      message: "Method not allowed" 
    });
  }

  let body = '';
  await new Promise((resolve) => {
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        req.body = body ? JSON.parse(body) : {};
      } catch (e) {
        req.body = {};
      }
      resolve();
    });
  });

  // ✅ Expects email and token (NOT otp!)
  const { email, token } = req.body;

  if (!email || !token) {
    return res.status(400).json({ 
      valid: false, 
      message: "Email and token required" 
    });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase environment variables');
    return res.status(500).json({
      valid: false,
      message: "Server configuration error"
    });
  }

  try {
    console.log(`[SP_VerifyToken] Verifying token for: ${email}`);

    const findUrl = `${supabaseUrl}/rest/v1/contacts?email=eq.${encodeURIComponent(email)}&select=*`;
    
    const findResponse = await fetch(findUrl, {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
      },
    });

    if (!findResponse.ok) {
      const errorText = await findResponse.text();
      console.error('[SP_VerifyToken] Find error:', errorText);
      return res.status(500).json({
        valid: false,
        message: "Failed to find contact"
      });
    }

    const findData = await findResponse.json();

    if (!findData || findData.length === 0) {
      console.log(`[SP_VerifyToken] No contact found for: ${email}`);
      return res.status(404).json({ 
        valid: false, 
        message: "User not found" 
      });
    }

    const contact = findData[0];
    console.log(`[SP_VerifyToken] Found contact: ${contact.id}`);

    const storedToken = contact.magic_link;
    const storedExpiry = contact.link_expiry;

    if (!storedToken || storedToken !== token) {
      console.log(`[SP_VerifyToken] Invalid token for: ${email}`);
      console.log(`[SP_VerifyToken] Stored: ${storedToken}, Received: ${token}`);
      return res.status(401).json({ 
        valid: false, 
        message: "Invalid token" 
      });
    }

    if (storedExpiry) {
      const now = new Date();
      const expiry = new Date(storedExpiry);
      if (now > expiry) {
        console.log(`[SP_VerifyToken] Expired token for: ${email}`);
        return res.status(401).json({ 
          valid: false, 
          message: "Session expired. Please request a new login link." 
        });
      }
    }

    console.log(`[SP_VerifyToken] Successfully verified token for: ${email}`);

    const firstName = contact.first_name || "";
    const lastName = contact.last_name || "";
    const fullName = `${firstName} ${lastName}`.trim();

    return res.status(200).json({ 
      valid: true, 
      email: email,
      firstName: firstName,
      lastName: lastName,
      fullName: fullName || email,
      message: "Authentication successful" 
    });

  } catch (err) {
    console.error("[SP_VerifyToken] Error:", err);
    return res.status(500).json({ 
      valid: false, 
      message: "Server error. Please try again." 
    });
  }
}