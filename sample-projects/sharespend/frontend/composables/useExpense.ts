import { ref } from 'vue';
import { expenseApi, type CreateExpensePayload } from '~/services/expenseApi';

export function useExpense() {
  const expenses = ref<any[]>([]);
  const isLoading = ref(false);

  async function fetchExpenses(groupId: number) {
    isLoading.value = true;
    try {
      const res = await expenseApi.list(groupId);
      expenses.value = res.data;
    } finally {
      isLoading.value = false;
    }
  }

  async function createNewExpense(payload: CreateExpensePayload) {
    isLoading.value = true;
    try {
      const res = await expenseApi.create(payload);
      expenses.value.unshift(res.data);
      return res.data;
    } finally {
      isLoading.value = false;
    }
  }

  async function removeExpense(id: number) {
    await expenseApi.remove(id);
    expenses.value = expenses.value.filter((item) => item.id !== id);
  }

  return {
    expenses,
    isLoading,
    fetchExpenses,
    createNewExpense,
    removeExpense,
  };
}
