<?php

namespace App\Models;

use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Database\Eloquent\Relations\HasMany;

class User extends Authenticatable
{
    protected $table = 'users';

    protected $fillable = [
        'name',
        'email',
        'password',
        'avatar_url',
    ];

    public function expenses(): HasMany
    {
        return $this->hasMany(Expense::class, 'payer_id');
    }

    public function groupMemberships(): HasMany
    {
        return $this->hasMany(GroupMember::class, 'user_id');
    }

    public function expenseSplits(): HasMany
    {
        return $this->hasMany(ExpenseSplit::class, 'user_id');
    }
}
