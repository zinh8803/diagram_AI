<script setup lang="ts">
import { reactive, ref } from 'vue';
import { authApi } from '~/services/authApi';

const credentials = reactive({
  email: '',
  password: '',
});
const loginError = ref('');

async function onLoginSubmit() {
  try {
    const res = await authApi.login(credentials);
    if (res.token) {
      localStorage.setItem('auth_token', res.token);
    }
  } catch (err: any) {
    loginError.value = err.message || 'Đăng nhập thất bại';
  }
}
</script>

<template>
  <div class="login-page">
    <form @submit.prevent="onLoginSubmit">
      <h2>Đăng nhập ShareSpend</h2>
      <input v-model="credentials.email" type="email" placeholder="Email" />
      <input v-model="credentials.password" type="password" placeholder="Mật khẩu" />
      <button type="submit">Đăng nhập</button>
    </form>
  </div>
</template>
