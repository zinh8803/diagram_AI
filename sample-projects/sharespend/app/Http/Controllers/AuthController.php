<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;

class AuthController extends Controller
{
    /**
     * Đăng nhập người dùng và cấp API Token
     */
    public function login(Request $request): JsonResponse
    {
        $credentials = $request->validate([
            'email' => 'required|email',
            'password' => 'required|string'
        ]);

        $user = User::where('email', $credentials['email'])->first();

        if (!$user || !Hash::check($credentials['password'], $user->password)) {
            return response()->json([
                'status' => 'error',
                'message' => 'Email hoặc mật khẩu không chính xác'
            ], 401);
        }

        $token = $user->createToken('sharespend-token')->plainTextToken;

        return response()->json([
            'status' => 'success',
            'token' => $token,
            'user' => $user
        ]);
    }

    public function register(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => 'required|string|max:100',
            'email' => 'required|email|unique:users,email',
            'password' => 'required|string|min:8'
        ]);

        $user = User::create([
            'name' => $validated['name'],
            'email' => $validated['email'],
            'password' => Hash::make($validated['password'])
        ]);

        return response()->json([
            'status' => 'success',
            'data' => $user
        ], 201);
    }
}
