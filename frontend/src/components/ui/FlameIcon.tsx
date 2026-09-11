// The app's mark: a flame, for the brand and for anywhere else one is
// wanted at a given size/colour via className (it inherits currentColor).
export function FlameIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12.963 2.286a.75.75 0 00-1.071-.136 9.742 9.742 0 00-3.539 6.176 7.547 7.547 0 01-1.705-1.715.75.75 0 00-1.152-.082A9 9 0 1015.68 4.534a7.46 7.46 0 01-2.717-2.248zM15.75 14.25a3.75 3.75 0 11-7.313-1.172c.628.465 1.35.81 2.133.998a5.24 5.24 0 01-.062-.831 5.23 5.23 0 011.446-3.798A3.75 3.75 0 0115.75 14.25z" />
    </svg>
  );
}
