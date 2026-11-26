<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ExpenseSplit extends Model
{
    protected $table = 'expense_splits';

    protected $fillable = [
        'expense_id',
        'user_id',
        'share_amount',
        'is_settled',
    ];

    public function expense(): BelongsTo
    {
        return $this->belongsTo(Expense::class, 'expense_id');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }
}
