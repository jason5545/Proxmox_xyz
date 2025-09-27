import { useEffect, useState } from "react";

export function useLocalStorage(key, initialValue) {
  const [state, setState] = useState(() => {
    if (typeof window === "undefined") return initialValue;
    const saved = window.localStorage.getItem(key);
    return saved ?? initialValue;
  });

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(key, state);
    }
  }, [key, state]);

  return [state, setState];
}
