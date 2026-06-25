import CalBookingLightbox from '../../components/CalBookingLightbox';

// Inside your component:
<CalBookingLightbox
  isOpen={showBookingModal}
  onClose={() => setShowBookingModal(false)}
  user={user}
/>