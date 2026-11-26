<?php

namespace App\Http\Controllers;

use App\Http\Requests\ExpenseRequest;
use App\Services\ExpenseService;
use App\Models\Expense;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ExpenseController extends Controller
{
    protected ExpenseService $expenseService;

    public function __construct(ExpenseService $expenseService)
    {
        $this->expenseService = $expenseService;
    }

    /**
     * Lấy danh sách chi tiêu theo nhóm hoặc cá nhân
     */
    public function index(Request $request): JsonResponse
    {
        $groupId = $request->query('group_id');
        $expenses = Expense::with(['payer', 'group', 'splits'])
            ->when($groupId, fn($q) => $q->where('group_id', $groupId))
            ->orderByDesc('spent_at')
            ->get();

        return response()->json([
            'status' => 'success',
            'data' => $expenses
        ]);
    }

    /**
     * Tạo mới khoản chi tiêu và tự động chia tiền cho các thành viên
     */
    public function store(ExpenseRequest $request): JsonResponse
    {
        $validated = $request->validated();

        if ($validated['amount'] <= 0) {
            return response()->json([
                'status' => 'error',
                'message' => 'Số tiền chi tiêu phải lớn hơn 0'
            ], 422);
        }

        $expense = $this->expenseService->create($validated, $request->user()->id);

        return response()->json([
            'status' => 'success',
            'message' => 'Tạo khoản chi tiêu thành công',
            'data' => $expense
        ], 201);
    }

    /**
     * Cập nhật khoản chi tiêu
     */
    public function update(ExpenseRequest $request, int $id): JsonResponse
    {
        $expense = $this->expenseService->updateExpense($id, $request->validated());

        return response()->json([
            'status' => 'success',
            'data' => $expense
        ]);
    }

    /**
     * Xóa khoản chi tiêu
     */
    public function destroy(int $id): JsonResponse
    {
        $expense = Expense::findOrFail($id);
        $expense->delete();

        return response()->json([
            'status' => 'success',
            'message' => 'Đã xóa khoản chi tiêu'
        ]);
    }
}
