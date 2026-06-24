// lib/cal-api.js

const EVENT_TYPE_ID = parseInt(process.env.NEXT_PUBLIC_CAL_EVENT_TYPE_ID || '344929');
const CAL_API_KEY = process.env.CAL_API_KEY;

// Your fixed availability schedule (as fallback when API is down)
const AVAILABILITY_SCHEDULE = {
  monday: { start: '14:00', end: '17:00', available: true },
  tuesday: { start: '14:00', end: '17:00', available: true },
  wednesday: { start: '14:00', end: '17:00', available: true },
  thursday: { start: '14:00', end: '17:00', available: true },
  friday: { start: '14:00', end: '16:00', available: true },
  saturday: { available: false },
  sunday: { available: false }
};

export async function getAvailableSlots(date, timezone = 'Europe/London') {
  const dateStr = date.toISOString().split('T')[0];
  
  try {
    // Try Cal.com API first
    const response = await fetch(
      `https://api.cal.com/v2/slots?username=turnkii&eventSlug=15min&startTime=${dateStr}T00:00:00Z&endTime=${dateStr}T23:59:59Z&timeZone=${timezone}`,
      {
        headers: {
          'cal-api-version': '2024-08-13'
        }
      }
    );

    if (!response.ok) {
      throw new Error('API unavailable');
    }

    const data = await response.json();
    
    if (data.status === 'error') {
      throw new Error(data.error?.message || 'API error');
    }

    // Return slots from API
    return data.data[dateStr] || [];
    
  } catch (error) {
    console.warn('Using fallback availability:', error.message);
    // Fallback to manual schedule
    return getManualSlots(date);
  }
}

export async function createBooking({ startTime, attendeeName, attendeeEmail, notes = '' }) {
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
        name: attendeeName,
        email: attendeeEmail,
        timeZone: 'Europe/London'
      },
      bookingFieldsResponses: {
        notes: notes || ''
      }
    })
  });

  const data = await response.json();
  
  if (data.status !== 'success') {
    throw new Error(data.error?.message || 'Failed to create booking');
  }
  
  return data.data;
}

// Fallback function
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
        end: slotEnd.toISOString()
      });
    }
    current = slotEnd;
  }
  
  return slots;
}