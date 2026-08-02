import { equalTo, onValue, orderByChild, query, ref } from 'firebase/database';
import { useEffect, useState } from 'react';
import { db } from '../firebase';

export function useRealtimeValue<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!path) {
      setData(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    const unsubscribe = onValue(
      ref(db, path),
      (snapshot) => {
        setData(snapshot.exists() ? (snapshot.val() as T) : null);
        setLoading(false);
      },
      (reason) => {
        setError(reason.message);
        setLoading(false);
      },
    );

    return unsubscribe;
  }, [path]);

  return { data, loading, error };
}


export function useRealtimeQuery<T>(path: string | null, child: string, equalValue: string | number | boolean | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!path) {
      setData(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    const request = query(ref(db, path), orderByChild(child), equalTo(equalValue));
    const unsubscribe = onValue(
      request,
      (snapshot) => {
        setData(snapshot.exists() ? (snapshot.val() as T) : null);
        setLoading(false);
      },
      (reason) => {
        setError(reason.message);
        setLoading(false);
      },
    );

    return unsubscribe;
  }, [path, child, equalValue]);

  return { data, loading, error };
}
