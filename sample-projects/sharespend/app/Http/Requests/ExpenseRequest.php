<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class ExpenseRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'group_id' => 'required|integer|exists:groups,id',
            'title' => 'required|string|max:255',
            'amount' => 'required|numeric|min:1',
            'category' => 'required|string|max:64',
            'spent_at' => 'required|date',
            'split_user_ids' => 'required|array|min:1',
            'split_user_ids.*' => 'integer|exists:users,id',
        ];
    }
}
