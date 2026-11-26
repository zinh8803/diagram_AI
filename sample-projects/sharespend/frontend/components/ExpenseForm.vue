<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useExpense } from '~/composables/useExpense';

const props = defineProps<{
  groupId: number;
}>();

const emit = defineEmits(['saved', 'close']);
const { createNewExpense } = useExpense();
const errorMsg = ref('');

const form = reactive({
  title: '',
  amount: 0,
  category: 'food',
  spent_at: new Date().toISOString(),
  split_user_ids: [1, 2, 3],
});

async function onSubmit() {
  if (!form.title || form.amount <= 0) {
    errorMsg.value = 'Vui lòng nhập tiêu đề và số tiền hợp lệ';
    return;
  }

  const result = await createNewExpense({
    group_id: props.groupId,
    title: form.title,
    amount: form.amount,
    category: form.category,
    spent_at: form.spent_at,
    split_user_ids: form.split_user_ids,
  });

  if (result) {
    emit('saved', result);
    emit('close');
  }
}
</script>

<template>
  <form class="expense-form" @submit.prevent="onSubmit">
    <h3>Tạo chi tiêu mới</h3>
    <input v-model="form.title" placeholder="Tên khoản chi (VD: Ăn tối lẩu)" />
    <input v-model.number="form.amount" type="number" placeholder="Số tiền (VND)" />
    <select v-model="form.category">
      <option value="food">Ăn uống</option>
      <option value="travel">Di chuyển</option>
      <option value="stay">Lưu trú</option>
    </select>
    <p v-if="errorMsg" class="error">{{ errorMsg }}</p>
    <button type="submit">Lưu khoản chi</button>
  </form>
</template>
