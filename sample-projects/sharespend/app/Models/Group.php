<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Group extends Model
{
    protected $table = 'groups';

    protected $fillable = [
        'name',
        'owner_id',
        'currency',
    ];

    public function owner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'owner_id');
    }

    public function members(): HasMany
    {
        return $this->hasMany(GroupMember::class, 'group_id');
    }

    public function expenses(): HasMany
    {
        return $this->hasMany(Expense::class, 'group_id');
    }
}
