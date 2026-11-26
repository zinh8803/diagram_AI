<?php

namespace App\Services;

use App\Models\Expense;
use App\Models\ExpenseSplit;
use App\Models\GroupMember;
use App\Jobs\SendExpenseNotificationJob;
use Illuminate\Support\Facades\DB;

class ExpenseService
{
    /**
     * Tạo khoản chi tiêu trong DB Transaction và chia phần cho các thành viên
     */
    public function create(array $data, int $payerId): Expense
    {
        return DB::transaction(function () use ($data, $payerId) {
            $expense = Expense::create([
                'group_id' => $data['group_id'],
                'payer_id' => $payerId,
                'title' => $data['title'],
                'amount' => $data['amount'],
                'category' => $data['category'],
                'spent_at' => $data['spent_at'],
            ]);

            $memberIds = $data['split_user_ids'];
            $shareAmount = round($data['amount'] / count($memberIds), 2);

            foreach ($memberIds as $userId) {
                ExpenseSplit::create([
                    'expense_id' => $expense->id,
                    'user_id' => $userId,
                    'share_amount' => $shareAmount,
                    'is_settled' => $userId === $payerId,
                ]);
            }

            // Cập nhật tổng chi tiêu của thành viên trong nhóm
            GroupMember::where('group_id', $data['group_id'])
                ->where('user_id', $payerId)
                ->increment('total_paid', $data['amount']);

            // Đẩy job gửi thông báo qua Queue
            SendExpenseNotificationJob::dispatch($expense);

            return $expense->load(['splits', 'payer', 'group']);
        });
    }

    public function updateExpense(int $id, array $data): Expense
    {
        return DB::transaction(function () use ($id, $data) {
            $expense = Expense::findOrFail($id);
            $expense->update([
                'title' => $data['title'],
                'amount' => $data['amount'],
                'category' => $data['category'],
                'spent_at' => $data['spent_at'],
            ]);

            return $expense;
        });
    }
}
