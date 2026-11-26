export interface CreateExpensePayload {
  group_id: number;
  title: string;
  amount: number;
  category: string;
  spent_at: string;
  split_user_ids: number[];
}

export const expenseApi = {
  async list(groupId: number) {
    const res = await fetch(`/api/expenses?group_id=${groupId}`, {
      method: 'GET',
    });
    return res.json();
  },

  async create(payload: CreateExpensePayload) {
    const res = await fetch('/api/expenses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.json();
  },

  async update(id: number, payload: Partial<CreateExpensePayload>) {
    const res = await fetch(`/api/expenses/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.json();
  },

  async remove(id: number) {
    const res = await fetch(`/api/expenses/${id}`, {
      method: 'DELETE',
    });
    return res.json();
  },
};
