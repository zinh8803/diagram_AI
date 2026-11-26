<?php

namespace App\Services;

use App\Models\Settlement;
use App\Models\ExpenseSplit;
use Illuminate\Support\Facades\DB;

class SettlementService
{
    public function processSettlement(
        int $groupId,
        int $payerId,
        int $receiverId,
        float $amount,
        string $paymentMethod
    ): Settlement {
        return DB::transaction(function () use ($groupId, $payerId, $receiverId, $amount, $paymentMethod) {
            $settlement = Settlement::create([
                'group_id' => $groupId,
                'payer_id' => $payerId,
                'receiver_id' => $receiverId,
                'amount' => $amount,
                'payment_method' => $paymentMethod,
                'status' => 'completed',
                'settled_at' => now(),
            ]);

            ExpenseSplit::where('user_id', $payerId)
                ->where('is_settled', false)
                ->update(['is_settled' => true]);

            return $settlement;
        });
    }
}
