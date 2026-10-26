import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  fetchSessionUser,
  logoutSession,
  type PaymentsUser,
} from "./lib/robomapSso";

export type Balance = { code: string; amount: number };
export type Recipient = {
  id: string;
  name: string;
  country: string;
  currency: string;
  accountHint: string;
  lastSent?: string;
};
export type ActivityItem = {
  id: string;
  title: string;
  sub: string;
  amount: number;
  currency: string;
  direction: "in" | "out";
  status: "completed" | "processing";
  at: string;
};

const STORAGE_KEY = "robomap-payments-v1";

const DEMO_BALANCES: Balance[] = [
  { code: "USD", amount: 4280.55 },
  { code: "EUR", amount: 1890.2 },
  { code: "GBP", amount: 640 },
  { code: "JPY", amount: 125000 },
];

const DEMO_RECIPIENTS: Recipient[] = [
  {
    id: "r1",
    name: "Marta Costa",
    country: "Portugal",
    currency: "EUR",
    accountHint: "PT50 •••• 8821",
    lastSent: "2 days ago",
  },
  {
    id: "r2",
    name: "James Okonkwo",
    country: "United Kingdom",
    currency: "GBP",
    accountHint: "GB29 •••• 4410",
    lastSent: "Last week",
  },
  {
    id: "r3",
    name: "Yuki Tanaka",
    country: "Japan",
    currency: "JPY",
    accountHint: "JP90 •••• 1193",
  },
  {
    id: "r4",
    name: "Sofia Alvarez",
    country: "Mexico",
    currency: "USD",
    accountHint: "MX12 •••• 3301",
    lastSent: "Yesterday",
  },
];

const DEMO_ACTIVITY: ActivityItem[] = [
  {
    id: "a1",
    title: "Sent to Marta Costa",
    sub: "EUR · Portugal",
    amount: -250,
    currency: "EUR",
    direction: "out",
    status: "completed",
    at: "2 days ago",
  },
  {
    id: "a2",
    title: "Added from bank",
    sub: "USD",
    amount: 1000,
    currency: "USD",
    direction: "in",
    status: "completed",
    at: "Last week",
  },
];

type Persisted = {
  balances: Balance[];
  recipients: Recipient[];
  activity: ActivityItem[];
};

type Store = {
  user: PaymentsUser | null;
  authReady: boolean;
  balances: Balance[];
  recipients: Recipient[];
  activity: ActivityItem[];
  totalUsd: number;
  setUser: (user: PaymentsUser | null) => void;
  logout: () => Promise<void>;
  getBalance: (code: string) => number;
  sendMoney: (input: {
    recipientId: string;
    amount: number;
    fromCurrency: string;
  }) => { ok: boolean; error?: string };
  addMoney: (currency: string, amount: number) => { ok: boolean; error?: string };
  convertMoney: (from: string, to: string, amount: number) => { ok: boolean; error?: string };
  addRecipient: (input: Omit<Recipient, "id">) => { ok: boolean; id: string };
  resetDemo: () => void;
};

const StoreContext = createContext<Store | null>(null);

function roundAmount(amount: number, code: string): number {
  return code === "JPY" ? Math.round(amount) : Math.round(amount * 100) / 100;
}

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function defaultPersisted(): Persisted {
  return {
    balances: structuredClone(DEMO_BALANCES),
    recipients: structuredClone(DEMO_RECIPIENTS),
    activity: structuredClone(DEMO_ACTIVITY),
  };
}

function loadPersisted(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultPersisted();
    const parsed = JSON.parse(raw) as Partial<Persisted> & { user?: unknown };
    return {
      balances: parsed.balances?.length ? parsed.balances : structuredClone(DEMO_BALANCES),
      recipients: parsed.recipients?.length
        ? parsed.recipients
        : structuredClone(DEMO_RECIPIENTS),
      activity: parsed.activity?.length ? parsed.activity : structuredClone(DEMO_ACTIVITY),
    };
  } catch {
    return defaultPersisted();
  }
}

function adjustBalance(balances: Balance[], code: string, delta: number): Balance[] {
  const next = balances.map((b) => ({ ...b }));
  const idx = next.findIndex((b) => b.code === code);
  const amount = roundAmount((idx >= 0 ? next[idx].amount : 0) + delta, code);
  if (idx >= 0) next[idx] = { code, amount };
  else next.push({ code, amount });
  return next.filter((b) => b.amount > 0 || DEMO_BALANCES.some((d) => d.code === b.code));
}

const FX: Record<string, number> = {
  USD: 1,
  EUR: 1.08,
  GBP: 1.27,
  JPY: 0.0067,
};

function toUsd(amount: number, code: string): number {
  return amount * (FX[code] ?? 1);
}

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PaymentsUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [persisted, setPersisted] = useState<Persisted>(() => loadPersisted());

  useEffect(() => {
    let cancelled = false;
    fetchSessionUser()
      .then((sessionUser) => {
        if (!cancelled) setUser(sessionUser);
      })
      .finally(() => {
        if (!cancelled) setAuthReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  }, [persisted]);

  const logout = useCallback(async () => {
    await logoutSession();
    setUser(null);
  }, []);

  const getBalance = useCallback(
    (code: string) => persisted.balances.find((b) => b.code === code)?.amount ?? 0,
    [persisted.balances],
  );

  const sendMoney = useCallback(
    (input: { recipientId: string; amount: number; fromCurrency: string }) => {
      const recipient = persisted.recipients.find((r) => r.id === input.recipientId);
      if (!recipient) return { ok: false, error: "Recipient not found" };
      if (input.amount <= 0) return { ok: false, error: "Enter an amount" };
      if (getBalance(input.fromCurrency) < input.amount) {
        return { ok: false, error: "Insufficient balance" };
      }
      setPersisted((state) => ({
        ...state,
        balances: adjustBalance(state.balances, input.fromCurrency, -input.amount),
        activity: [
          {
            id: uid("a"),
            title: `Sent to ${recipient.name}`,
            sub: `${recipient.currency} · ${recipient.country}`,
            amount: -input.amount,
            currency: input.fromCurrency,
            direction: "out",
            status: "completed",
            at: "Just now",
          },
          ...state.activity,
        ],
        recipients: state.recipients.map((r) =>
          r.id === recipient.id ? { ...r, lastSent: "Just now" } : r,
        ),
      }));
      return { ok: true };
    },
    [getBalance, persisted.recipients],
  );

  const addMoney = useCallback((currency: string, amount: number) => {
    if (amount <= 0) return { ok: false, error: "Enter an amount" };
    setPersisted((state) => ({
      ...state,
      balances: adjustBalance(state.balances, currency, amount),
      activity: [
        {
          id: uid("a"),
          title: "Added from bank",
          sub: currency,
          amount,
          currency,
          direction: "in",
          status: "completed",
          at: "Just now",
        },
        ...state.activity,
      ],
    }));
    return { ok: true };
  }, []);

  const convertMoney = useCallback(
    (from: string, to: string, amount: number) => {
      if (from === to) return { ok: false, error: "Pick two different currencies" };
      if (amount <= 0) return { ok: false, error: "Enter an amount" };
      if (getBalance(from) < amount) return { ok: false, error: "Insufficient balance" };
      const usd = toUsd(amount, from);
      const received = roundAmount(usd / (FX[to] ?? 1), to);
      setPersisted((state) => ({
        ...state,
        balances: adjustBalance(adjustBalance(state.balances, from, -amount), to, received),
        activity: [
          {
            id: uid("a"),
            title: `Converted ${from} → ${to}`,
            sub: "Mid-market rate",
            amount: received,
            currency: to,
            direction: "in",
            status: "completed",
            at: "Just now",
          },
          ...state.activity,
        ],
      }));
      return { ok: true };
    },
    [getBalance],
  );

  const addRecipient = useCallback((input: Omit<Recipient, "id">) => {
    const id = uid("r");
    setPersisted((state) => ({
      ...state,
      recipients: [{ ...input, id }, ...state.recipients],
    }));
    return { ok: true, id };
  }, []);

  const resetDemo = useCallback(() => {
    setPersisted(defaultPersisted());
  }, []);

  const totalUsd = useMemo(
    () => persisted.balances.reduce((sum, b) => sum + toUsd(b.amount, b.code), 0),
    [persisted.balances],
  );

  const value = useMemo<Store>(
    () => ({
      user,
      authReady,
      balances: persisted.balances,
      recipients: persisted.recipients,
      activity: persisted.activity,
      totalUsd,
      setUser,
      logout,
      getBalance,
      sendMoney,
      addMoney,
      convertMoney,
      addRecipient,
      resetDemo,
    }),
    [
      user,
      authReady,
      persisted,
      totalUsd,
      logout,
      getBalance,
      sendMoney,
      addMoney,
      convertMoney,
      addRecipient,
      resetDemo,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useAppStore(): Store {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useAppStore must be used within AppStoreProvider");
  return ctx;
}

export function formatMoney(amount: number, code: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      maximumFractionDigits: code === "JPY" ? 0 : 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${code}`;
  }
}
