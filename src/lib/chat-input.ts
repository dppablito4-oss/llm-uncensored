// Mobile keyboards should insert newlines; sending remains an explicit tap.
export function usesMobileKeyboard() {
  return (
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    window.matchMedia?.("(pointer: coarse)").matches === true
  );
}
