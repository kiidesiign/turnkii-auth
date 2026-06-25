// components/CalBookingLightbox.js
import { useRef, useEffect } from 'react';
import Cal, { getCalApi } from "@calcom/embed-react";

export default function CalBookingLightbox({ isOpen, onClose, user }) {
  const calRef = useRef();

  useEffect(() => {
    if (isOpen && calRef.current) {
      // Optionally refresh or configure the embed when opened
    }
  }, [isOpen]);

  if (!isOpen || !user) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-4xl h-[90vh] relative">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 bg-white rounded-full p-2 shadow hover:bg-gray-100"
        >
          ✕
        </button>
        <div className="w-full h-full p-4">
          <Cal
            calLink="turnkii/15min"
            config={{
              name: `${user.first_name} ${user.last_name}`,
              email: user.email,
              notes: `Phone: ${user.phone || 'Not provided'}`,
            }}
          />
        </div>
      </div>
    </div>
  );
}