<?php

namespace App\Http\Controllers;

use App\Services\SettlementService;
use App\Models\Settlement;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SettlementController extends Controller
{
    protected SettlementService $settlementService;

    public function __construct(SettlementService $settlementService)
    {
        $this->settlementService = $settlementService;
    }

    /**
     * Thanh toán công nợ giữa các thành viên trong nhóm
     */
    public function settle(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'group_id' => 'required|integer|exists:groups,id',
            'receiver_id' => 'required|integer|exists:users,id',
            'amount' => 'required|numeric|min:1000',
            'payment_method' => 'required|string|in:bank_transfer,wallet,cash'
        ]);

        $settlement = $this->settlementService->processSettlement(
            $validated['group_id'],
            $request->user()->id,
            $validated['receiver_id'],
            $validated['amount'],
            $validated['payment_method']
        );

        return response()->json([
            'status' => 'success',
            'data' => $settlement
        ], 201);
    }

    public function history(Request $request): JsonResponse
    {
        $items = Settlement::with(['payer', 'receiver', 'group'])
            ->orderByDesc('settled_at')
            ->get();

        return response()->json(['data' => $items]);
    }
}
