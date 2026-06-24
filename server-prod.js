// server-prod.js
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';

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

// Cal.com Configuration
const EVENT_TYPE_ID = process.env.EVENT_TYPE_ID || 344929;
const CAL_API_KEY = process.env.CAL_API_KEY || 'cal_live_77bf74a698416a5dac2e9ff0bfef13f8';

// Your availability schedule
const AVAILABILITY_SCHEDULE = {
  monday: { start: '14:00', end: '17:00', available: true },
  tuesday: { start: '14:00', end: '17:00', available: true },
  wednesday: { start: '14:00', end: '17:00', available: true },
  thursday: { start: '14:00', end: '17:00', available: true },
  friday: { start: '14:00', end: '16:00', available: true },
  saturday: { available: false },
  sunday: { available: false }
};

// API: Get available slots
app.get('/api/slots', async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) {
      return res.status(400).json({ error: 'Date is required' });
    }

    const slots = getManualSlots(new Date(date));
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

    if (!startTime || !name || !email) {
      return res.status(400).json({ 
        error: 'Missing required fields: startTime, name, email' 
      });
    }

    const response = await fetch('https://api.cal.com/v2/bookings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'cal-api-version': '2024-08-13'
      },
      body: JSON.stringify({
        eventTypeId: EVENT_TYPE_ID,
        start: startTime,
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
    console.error('Booking error:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to create booking' 
    });
  }
});

// API: Webhook handler (for Cal.com webhooks)
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

// Helper function: Generate manual slots
function getManualSlots(date) {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayName = days[date.getDay()];
  const daySchedule = AVAILABILITY_SCHEDULE[dayName];

  if (!daySchedule || !daySchedule.available) {
    return [];
  }

  const slots = [];
  const dateStr = date.toISOString().split('T')[0];
  const startTime = new Date(`${dateStr}T${daySchedule.start}:00Z`);
  const endTime = new Date(`${dateStr}T${daySchedule.end}:00Z`);

  let current = new Date(startTime);
  while (current < endTime) {
    const slotEnd = new Date(current.getTime() + 15 * 60000);
    if (slotEnd <= endTime) {
      slots.push({
        start: current.toISOString(),
        display: current.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit'
        })
      });
    }
    current = slotEnd;
  }

  return slots;
}

// Serve the booking page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'booking.html'));
});

// Health check endpoint (for Vercel)
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Start server (for local development)
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
    console.log(`📅 Booking page: http://localhost:${PORT}/`);
    console.log(`🔍 Health check: http://localhost:${PORT}/api/health`);
  });
}

// Export for Vercel serverless functions
export default app;