<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Expense extends Model
{
    protected $table = 'expenses';

    protected $fillable = [
        'group_id',
        'payer_id',
        'title',
        'amount',
        'category',
        'spent_at',
    ];

    public function group(): BelongsTo
    {
        return $this->belongsTo(Group::class, 'group_id');
    }

    public function payer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'payer_id');
    }

    public function splits(): HasMany
    {
        return $this->hasMany(ExpenseSplit::class, 'expense_id');
    }
}
