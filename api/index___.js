// api/index.js (Vercel serverless function)
import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Cal.com Configuration
const EVENT_TYPE_ID = 344929;
const CAL_API_KEY = 'cal_live_77bf74a698416a5dac2e9ff0bfef13f8';

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

export default app;