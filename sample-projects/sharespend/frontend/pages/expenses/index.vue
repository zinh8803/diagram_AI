<script setup lang="ts">
import { ref, onMounted } from 'vue';
import ExpenseForm from '~/components/ExpenseForm.vue';
import SettlementModal from '~/components/SettlementModal.vue';
import { useExpense } from '~/composables/useExpense';

const { expenses, isLoading, fetchExpenses, removeExpense } = useExpense();
const showCreateModal = ref(false);
const showSettlementModal = ref(false);
const activeGroupId = ref(1);

onMounted(async () => {
  await fetchExpenses(activeGroupId.value);
});

async function handleDeleteExpense(id: number) {
  await removeExpense(id);
}
</script>

<template>
  <div class="expenses-page">
    <header class="page-header">
      <h1>Quản lý Chi tiêu Nhóm (ShareSpend)</h1>
      <div class="actions">
        <button @click="showCreateModal = true">Tạo khoản chi mới</button>
        <button @click="showSettlementModal = true">Thanh toán công nợ</button>
      </div>
    </header>

    <ExpenseForm
      v-if="showCreateModal"
      :group-id="activeGroupId"
      @saved="fetchExpenses(activeGroupId)"
      @close="showCreateModal = false"
    />

    <SettlementModal
      v-if="showSettlementModal"
      :group-id="activeGroupId"
      @settled="fetchExpenses(activeGroupId)"
      @close="showSettlementModal = false"
    />

    <ul class="expense-list">
      <li v-for="item in expenses" :key="item.id">
        <span>{{ item.title }} - {{ item.amount }} VND</span>
        <button @click="handleDeleteExpense(item.id)">Xóa</button>
      </li>
    </ul>
  </div>
</template>
