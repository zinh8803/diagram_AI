<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\ExpenseController;
use App\Http\Controllers\GroupController;
use App\Http\Controllers\SettlementController;
use App\Http\Controllers\AuthController;

/*
|--------------------------------------------------------------------------
| API Routes - ShareSpend Application
|--------------------------------------------------------------------------
*/

Route::post('/api/auth/login', [AuthController::class, 'login']);
Route::post('/api/auth/register', [AuthController::class, 'register']);

Route::middleware(['auth:sanctum'])->group(function () {
    // Expenses CRUD & Workflow
    Route::get('/api/expenses', [ExpenseController::class, 'index']);
    Route::post('/api/expenses', [ExpenseController::class, 'store']);
    Route::put('/api/expenses/{id}', [ExpenseController::class, 'update']);
    Route::delete('/api/expenses/{id}', [ExpenseController::class, 'destroy']);

    // Groups Management
    Route::get('/api/groups', [GroupController::class, 'index']);
    Route::post('/api/groups', [GroupController::class, 'store']);
    Route::post('/api/groups/{id}/members', [GroupController::class, 'addMember']);
    Route::delete('/api/groups/{id}/members/{userId}', [GroupController::class, 'removeMember']);

    // Settlements & Payment Flow
    Route::post('/api/settlements', [SettlementController::class, 'settle']);
    Route::get('/api/settlements/history', [SettlementController::class, 'history']);
});
