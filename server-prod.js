// server-prod.js
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true
}));
app.use(express.json());
app.use(express.static('public'));

// Cal.EU Configuration
const EVENT_TYPE_ID = parseInt(process.env.EVENT_TYPE_ID || process.env.NEXT_PUBLIC_CAL_EVENT_TYPE_ID || '344929', 10);
const CAL_API_KEY = process.env.CAL_API_KEY || '';

console.log(`📅 Event Type ID: ${EVENT_TYPE_ID}`);
console.log(`🔑 CAL_API_KEY exists: ${CAL_API_KEY ? 'Yes' : 'No'}`);

// 🔥 AVAILABILITY IN UTC (London is UTC+1 during BST)
// London 14:00-17:00 = UTC 13:00-16:00
// London 14:00-16:00 (Fri) = UTC 13:00-15:00
const AVAILABILITY_SCHEDULE = {
  monday:    { start: 13, end: 16 }, // 14:00-17:00 London
  tuesday:   { start: 13, end: 16 },
  wednesday: { start: 13, end: 16 },
  thursday:  { start: 13, end: 16 },
  friday:    { start: 13, end: 15 }, // 14:00-16:00 London
  saturday:  null,
  sunday:    null
};

// API: Get available slots
app.get('/api/slots', async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) {
      return res.status(400).json({ error: 'Date is required' });
    }

    const slots = getManualSlots(new Date(date));
    console.log(`📅 Slots for ${date}:`, slots.map(s => s.display));
    res.json({ slots });
  } catch (error) {
    console.error('Error getting slots:', error);
    res.status(500).json({ error: 'Failed to get slots' });
  }
});

// API: Create a booking
app.post('/api/book', async (req, res) => {
  try {
    const { startTime, name, email, notes } = req.body;

    console.log('📤 Booking request:', { startTime, name, email });

    if (!startTime || !name || !email) {
      return res.status(400).json({ 
        error: 'Missing required fields: startTime, name, email' 
      });
    }

    // Parse the time
    const bookingDate = new Date(startTime);
    const dayOfWeek = bookingDate.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
    const hour = bookingDate.getUTCHours();
    const minute = bookingDate.getUTCMinutes();

    // Check if it's a valid day
    const schedule = AVAILABILITY_SCHEDULE[dayOfWeek];
    if (!schedule) {
      return res.status(400).json({ 
        error: 'Bookings are only available Monday-Friday' 
      });
    }

    // Check if within hours (UTC)
    if (hour < schedule.start || hour > schedule.end || (hour === schedule.end && minute > 0)) {
      const startLondon = schedule.start + 1;
      const endLondon = schedule.end + 1;
      return res.status(400).json({ 
        error: `Bookings are only available ${startLondon}:00-${endLondon}:00 London time on ${dayOfWeek}` 
      });
    }

    // Ensure UTC format
    let start = startTime;
    if (!start.endsWith('Z')) {
      start = new Date(startTime).toISOString();
    }

    console.log('📤 Sending to Cal.eu:', { eventTypeId: EVENT_TYPE_ID, start });

    const response = await fetch('https://api.cal.eu/v2/bookings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'cal-api-version': '2024-08-13',
        'Authorization': `Bearer ${CAL_API_KEY}`
      },
      body: JSON.stringify({
        eventTypeId: EVENT_TYPE_ID,
        start: start,
        attendee: {
          name: name,
          email: email,
          timeZone: 'Europe/London'
        },
        bookingFieldsResponses: {
          notes: notes || ''
        }
      })
    });

    const data = await response.json();
    console.log('📥 Cal.eu response:', response.status);

    if (!response.ok) {
      throw new Error(data.error?.message || `HTTP ${response.status}`);
    }

    if (data.status !== 'success') {
      throw new Error(data.error?.message || 'Booking failed');
    }

    res.json({
      success: true,
      booking: {
        uid: data.data.uid,
        start: data.data.start,
        end: data.data.end,
        meetingUrl: data.data.meetingUrl,
        attendee: data.data.attendees[0]
      }
    });

  } catch (error) {
    console.error('❌ Booking error:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to create booking' 
    });
  }
});

// 🔥 FIXED: Generate 30-min slots
function getManualSlots(date) {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayName = days[date.getDay()];
  const schedule = AVAILABILITY_SCHEDULE[dayName];

  if (!schedule) return [];

  const slots = [];
  const dateStr = date.toISOString().split('T')[0];
  
  // Start and end in UTC
  const startHour = schedule.start;
  const endHour = schedule.end;
  
  for (let hour = startHour; hour < endHour; hour++) {
    // On the hour
    const timeStr = `${dateStr}T${String(hour).padStart(2, '0')}:00:00Z`;
    const dateObj = new Date(timeStr);
    
    // Display in London time (UTC+1 during BST)
    const londonTime = new Date(dateObj.getTime() + 60 * 60 * 1000);
    const display = londonTime.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    
    slots.push({
      start: timeStr,
      display: display
    });
  }

  return slots;
}

// API: Webhook handler
app.post('/api/cal-webhook', async (req, res) => {
  try {
    const secret = req.headers['x-cal-secret'];
    if (secret !== process.env.CAL_WEBHOOK_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { triggerEvent, payload } = req.body;
    console.log(`📅 Webhook received: ${triggerEvent}`);

    switch(triggerEvent) {
      case 'BOOKING_CREATED':
        console.log('✅ New booking:', payload.data.uid);
        console.log('👤 Attendee:', payload.data.attendees?.[0]?.name);
        console.log('📧 Email:', payload.data.attendees?.[0]?.email);
        console.log('⏰ Time:', payload.data.start);
        console.log('🔗 Meeting URL:', payload.data.meetingUrl);
        break;
      default:
        console.log(`Unhandled event: ${triggerEvent}`);
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Serve the booking page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'booking.html'));
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    eventTypeId: EVENT_TYPE_ID,
    hasApiKey: !!CAL_API_KEY
  });
});

// Start server
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
    console.log(`📅 Booking page: http://localhost:${PORT}/`);
    console.log(`🔍 Health check: http://localhost:${PORT}/api/health`);
  });
}

export default app;