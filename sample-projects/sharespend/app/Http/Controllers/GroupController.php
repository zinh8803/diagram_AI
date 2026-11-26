<?php

namespace App\Http\Controllers;

use App\Services\GroupService;
use App\Models\Group;
use App\Models\GroupMember;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class GroupController extends Controller
{
    protected GroupService $groupService;

    public function __construct(GroupService $groupService)
    {
        $this->groupService = $groupService;
    }

    public function index(Request $request): JsonResponse
    {
        $groups = Group::with(['members.user'])->get();
        return response()->json(['data' => $groups]);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => 'required|string|max:120',
            'currency' => 'required|string|size:3',
            'member_ids' => 'array'
        ]);

        $group = $this->groupService->createGroup($validated, $request->user()->id);

        return response()->json([
            'status' => 'success',
            'data' => $group
        ], 201);
    }

    public function addMember(Request $request, int $id): JsonResponse
    {
        $validated = $request->validate([
            'user_id' => 'required|integer|exists:users,id',
            'role' => 'nullable|string'
        ]);

        $member = $this->groupService->addMemberToGroup($id, $validated['user_id'], $validated['role'] ?? 'member');

        return response()->json([
            'status' => 'success',
            'data' => $member
        ]);
    }

    public function removeMember(int $id, int $userId): JsonResponse
    {
        GroupMember::where('group_id', $id)
            ->where('user_id', $userId)
            ->delete();

        return response()->json([
            'status' => 'success',
            'message' => 'Đã xóa thành viên khỏi nhóm'
        ]);
    }
}
