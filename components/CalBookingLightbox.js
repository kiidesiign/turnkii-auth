// components/CalBookingLightbox.js
import { useRef, useEffect } from 'react';
import Cal, { getCalApi } from "@calcom/embed-react";

export default function CalBookingLightbox({ isOpen, onClose, user }) {
  const calRef = useRef();

  useEffect(() => {
    if (isOpen && calRef.current) {
      (async function () {
        const cal = await getCalApi();
        cal("ui", {
          // 👇 Your custom CSS variables go here
          cssVarsPerTheme: {
            "cal-brand": "#3d0566",        // Your primary brand color
            "cal-brand-emphasis": "#2a0447", // Hover state
            "cal-border-booker": "#e2e8f0", // Border color of the widget
            "cal-border-booker-width": "1px",
            "radius": "8px",
            // You can find many more variables here: https://cal.com/docs/developing/guides/embeds/customize-embed-css-variables
          }
        });
      })();
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