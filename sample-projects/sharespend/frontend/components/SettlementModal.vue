<script setup lang="ts">
import { reactive } from 'vue';
import { useSettlement } from '~/composables/useSettlement';

const props = defineProps<{
  groupId: number;
}>();

const emit = defineEmits(['settled', 'close']);
const { submitSettlement } = useSettlement();

const form = reactive({
  receiver_id: 2,
  amount: 150000,
  payment_method: 'bank_transfer',
});

async function onSettleSubmit() {
  await submitSettlement({
    group_id: props.groupId,
    receiver_id: form.receiver_id,
    amount: form.amount,
    payment_method: form.payment_method,
  });
  emit('settled');
  emit('close');
}
</script>

<template>
  <form class="settlement-modal" @submit.prevent="onSettleSubmit">
    <h3>Thanh toán công nợ nhóm</h3>
    <input v-model.number="form.amount" type="number" />
    <button type="submit">Xác nhận thanh toán</button>
  </form>
</template>
