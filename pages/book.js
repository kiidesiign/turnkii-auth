// pages/book.js
import { useState, useEffect } from 'react';
import { getAvailableSlots, createBooking } from '../lib/cal-api';

export default function BookingPage() {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [availableSlots, setAvailableSlots] = useState([]);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [bookingSuccess, setBookingSuccess] = useState(null);
  const [error, setError] = useState(null);
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    notes: '',
    acceptTerms: false,
    acceptMarketing: false
  });

  useEffect(() => {
    fetchSlots(selectedDate);
  }, [selectedDate]);

  const fetchSlots = async (date) => {
    setLoading(true);
    setError(null);
    try {
      const slots = await getAvailableSlots(date);
      setAvailableSlots(slots);
    } catch (error) {
      console.error('Error fetching slots:', error);
      setError('Could not load available times. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleBooking = async (e) => {
    e.preventDefault();
    if (!selectedSlot) {
      alert('Please select a time slot');
      return;
    }
    if (!formData.firstName || !formData.lastName || !formData.email) {
      alert('Please fill in all required fields');
      return;
    }
    if (!formData.acceptTerms) {
      alert('You must accept the terms and conditions');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await createBooking({
        startTime: selectedSlot.start,
        firstName: formData.firstName,
        lastName: formData.lastName,
        email: formData.email,
        notes: formData.notes,
        acceptTerms: formData.acceptTerms,
        acceptMarketing: formData.acceptMarketing
      });

      setBookingSuccess(result);
      setSelectedSlot(null);
      setFormData({
        firstName: '',
        lastName: '',
        email: '',
        notes: '',
        acceptTerms: false,
        acceptMarketing: false
      });
      fetchSlots(selectedDate);
    } catch (error) {
      setError(error.message || 'Booking failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const isDateAvailable = (date) => {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayName = days[date.getDay()];
    const schedule = {
      monday: true, tuesday: true, wednesday: true, thursday: true,
      friday: true, saturday: false, sunday: false
    };
    return schedule[dayName];
  };

  return (
    <div className="max-w-2xl mx-auto p-6 bg-white rounded-lg shadow">
      <h2 className="text-2xl font-bold mb-6">Book a Meeting</h2>
      <p className="text-sm text-gray-600 mb-4">
        Available: Mon-Thu 14:00-17:00, Fri 14:00-16:00
      </p>

      {error && (
        <div className="mb-4 p-3 bg-red-100 text-red-700 rounded">
          {error}
        </div>
      )}

      {bookingSuccess && (
        <div className="mb-4 p-4 bg-green-100 rounded">
          <h3 className="font-bold text-green-800">✅ Booking Confirmed!</h3>
          <p>Meeting: {new Date(bookingSuccess.start).toLocaleString()}</p>
          {bookingSuccess.meetingUrl && (
            <a
              href={bookingSuccess.meetingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 underline"
            >
              Join Meeting
            </a>
          )}
        </div>
      )}

      {/* Date Picker */}
      <div className="mb-6">
        <label className="block text-sm font-medium mb-2">Select Date</label>
        <input
          type="date"
          value={selectedDate.toISOString().split('T')[0]}
          onChange={(e) => {
            const newDate = new Date(e.target.value);
            if (isDateAvailable(newDate)) {
              setSelectedDate(newDate);
            } else {
              alert('No availability on this day. Please select Mon-Fri.');
            }
          }}
          min={new Date().toISOString().split('T')[0]}
          className="w-full p-2 border rounded"
        />
      </div>

      {/* Available Slots */}
      <div className="mb-6">
        <label className="block text-sm font-medium mb-2">Available Times</label>
        {loading ? (
          <p>Loading available slots...</p>
        ) : availableSlots.length === 0 ? (
          <p className="text-gray-500">No available slots for this day</p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {availableSlots.map((slot, index) => (
              <button
                key={index}
                onClick={() => setSelectedSlot(slot)}
                className={`p-2 border rounded text-sm ${
                  selectedSlot?.start === slot.start
                    ? 'bg-blue-500 text-white'
                    : 'hover:bg-gray-100'
                }`}
              >
                {new Date(slot.start).toLocaleTimeString('en-US', {
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Booking Form */}
      {selectedSlot && (
        <form onSubmit={handleBooking} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">First Name *</label>
              <input
                type="text"
                required
                value={formData.firstName}
                onChange={(e) => setFormData({...formData, firstName: e.target.value})}
                className="w-full p-2 border rounded"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Last Name *</label>
              <input
                type="text"
                required
                value={formData.lastName}
                onChange={(e) => setFormData({...formData, lastName: e.target.value})}
                className="w-full p-2 border rounded"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Email *</label>
            <input
              type="email"
              required
              value={formData.email}
              onChange={(e) => setFormData({...formData, email: e.target.value})}
              className="w-full p-2 border rounded"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Notes (optional)</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({...formData, notes: e.target.value})}
              className="w-full p-2 border rounded"
              rows="3"
            />
          </div>

          <div className="flex items-start">
            <input
              type="checkbox"
              id="acceptTerms"
              checked={formData.acceptTerms}
              onChange={(e) => setFormData({...formData, acceptTerms: e.target.checked})}
              className="mt-1 mr-2"
              required
            />
            <label htmlFor="acceptTerms" className="text-sm">
              I agree to the Terms of Service and Privacy Policy *
            </label>
          </div>

          <div className="flex items-start">
            <input
              type="checkbox"
              id="acceptMarketing"
              checked={formData.acceptMarketing}
              onChange={(e) => setFormData({...formData, acceptMarketing: e.target.checked})}
              className="mt-1 mr-2"
            />
            <label htmlFor="acceptMarketing" className="text-sm">
              I would like to receive occasional updates and offers (optional)
            </label>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-500 text-white py-2 rounded hover:bg-blue-600 disabled:opacity-50"
          >
            {loading ? 'Booking...' : `Book for ${new Date(selectedSlot.start).toLocaleTimeString('en-US', {
              hour: '2-digit',
              minute: '2-digit'
            })}`}
          </button>
        </form>
      )}
    </div>
  );
}