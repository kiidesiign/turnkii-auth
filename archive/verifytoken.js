// api/verifyToken.js
import { findContactByEmail } from "../lib/zoho.js";

export default async function handler(req, res) {
  const CORS_ORIGIN = 'https://www.turnkii.es'; 

  // Handle CORS preflight (OPTIONS request)
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  // Set CORS headers for all responses
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { email, token } = req.body;

  if (!email || !token) {
    return res.status(400).json({ valid: false, message: "Email and token required" });
  }

  try {
    const contact = await findContactByEmail(email);

    if (!contact) {
      return res.status(404).json({ valid: false, message: "User not found" });
    }

    const storedToken = contact.Twitter;
    const storedExpiry = contact.Assistant;

    // Validate token
    if (!storedToken || storedToken !== token) {
      return res.status(401).json({ valid: false, message: "Invalid token" });
    }

    // Validate expiry
    if (storedExpiry) {
      const now = new Date();
      const expiry = new Date(storedExpiry);
      if (now > expiry) {
        return res.status(401).json({ valid: false, message: "Session expired. Please request a new login link." });
      }
    }

    // Extract name fields - adjust these field names based on your Zoho CRM
    const firstName = contact.First_Name || contact.FirstName || "";
    const lastName = contact.Last_Name || contact.LastName || "";
    const fullName = contact.Full_Name || `${firstName} ${lastName}`.trim();
    
    // Token is valid - return user details
    return res.status(200).json({ 
      valid: true, 
      email: email,
      firstName: firstName,
      lastName: lastName,
      fullName: fullName || email,
      message: "Authentication successful" 
    });

  } catch (err) {
    console.error("verifyToken error:", err);
    return res.status(500).json({ 
      valid: false, 
      message: "Server error. Please try again." 
    });
  }
}