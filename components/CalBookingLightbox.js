// In CalBookingLightbox.js
import { useRef, useEffect } from 'react';
import Cal, { getCalApi } from "@calcom/embed-react";

export default function CalBookingLightbox({ isOpen, onClose, user }) {
  const calRef = useRef();

  useEffect(() => {
    if (isOpen && calRef.current) {
      (async function () {
        const cal = await getCalApi();
        cal("ui", {
          cssVarsPerTheme: {
            "cal-brand": "#3d0566",
            "cal-brand-emphasis": "#2a0447",
            "cal-border-booker": "#e2e8f0",
            "cal-border-booker-width": "1px",
            "radius": "8px",
          },
          // hideBranding won't work on free plan, keep it anyway just in case
          hideBranding: true,
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
            eventTypeId={344929}
            config={{
              name: `${user.first_name} ${user.last_name}`,
              email: user.email,
              notes: `Phone: ${user.phone || 'Not provided'}`,
            }}
          />
        </div>
      </div>
      {/* 🔽 Scoped CSS to hide branding */}
      <style jsx>{`
        :global(.cal-embed .cal-branding),
        :global(.cal-embed .cal-footer),
        :global(.cal-embed [data-testid="branding"]),
        :global(.cal-embed .cal-logo),
        :global(.cal-embed .cal-branding-text) {
          display: none !important;
        }
        :global(.cal-embed .cal-panel-header h2),
        :global(.cal-embed .cal-header h2) {
          display: none !important;
        }
        :global(.cal-embed h2:has(+ .cal-availability)),
        :global(.cal-embed .cal-availability-heading) {
          display: none !important;
        }
      `}</style>
    </div>
  );
}