<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Settlement extends Model
{
    protected $table = 'settlements';

    protected $fillable = [
        'group_id',
        'payer_id',
        'receiver_id',
        'amount',
        'payment_method',
        'status',
        'settled_at',
    ];

    public function group(): BelongsTo
    {
        return $this->belongsTo(Group::class, 'group_id');
    }

    public function payer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'payer_id');
    }

    public function receiver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'receiver_id');
    }
}
