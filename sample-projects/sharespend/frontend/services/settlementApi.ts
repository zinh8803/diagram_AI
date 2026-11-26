export const settlementApi = {
  async settle(payload: {
    group_id: number;
    receiver_id: number;
    amount: number;
    payment_method: string;
  }) {
    const res = await fetch('/api/settlements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.json();
  },

  async getHistory() {
    const res = await fetch('/api/settlements/history', {
      method: 'GET',
    });
    return res.json();
  },
};
