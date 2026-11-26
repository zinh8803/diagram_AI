import { ref } from 'vue';
import { settlementApi } from '~/services/settlementApi';

export function useSettlement() {
  const isSubmitting = ref(false);

  async function submitSettlement(payload: {
    group_id: number;
    receiver_id: number;
    amount: number;
    payment_method: string;
  }) {
    isSubmitting.value = true;
    try {
      return await settlementApi.settle(payload);
    } finally {
      isSubmitting.value = false;
    }
  }

  return {
    isSubmitting,
    submitSettlement,
  };
}
