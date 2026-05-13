// ⚡ Cấu hình URL server
const CHAT_BACKEND_URL =
  window.location.protocol === 'file:' || ['localhost', '127.0.0.1'].includes(window.location.hostname)
    ? 'http://localhost:3000'
    : 'https://portfolio-2-wesv.onrender.com';

const socket = io(CHAT_BACKEND_URL);

// WebRTC Configuration
const peerConnectionConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

let peerConnection;
let localStream;
let currentCallerId = null; // socket ID of the guest

// DOM Elements
const incomingCallsContainer = document.getElementById('incoming-calls');
const videoContainer = document.getElementById('video-container');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const endCallBtn = document.getElementById('end-call-btn');
const adminMuteBtn = document.getElementById('admin-mute-btn');
const adminVideoBtn = document.getElementById('admin-video-toggle-btn');

// --- SOCKET LOGIC ---
socket.on('connect', () => {
  console.log('Connected to server');
  const password = prompt('Nhập mã OTP Admin (kiểm tra Telegram):');
  if (password) {
    socket.emit('admin:join', { password });
  }
});

socket.on('admin:auth_success', () => {
  console.log('Admin Authenticated');
  alert('Đăng nhập Admin thành công. Đang chờ cuộc gọi...');
});

socket.on('chat error', (data) => {
  alert('Lỗi: ' + data.error);
  if (data.error.includes('OTP') || data.error.includes('mật khẩu')) {
    const password = prompt('Nhập lại mã OTP hoặc mật khẩu Admin:');
    if (password) {
      socket.emit('admin:join', { password });
    }
  }
});

socket.on('call:incoming', ({ sessionId, callerId }) => {
  console.log('Incoming call from:', sessionId, callerId);

  // Create UI for incoming call
  const callEl = document.createElement('div');
  callEl.className = 'call-item';
  callEl.id = `call-${callerId}`;
  callEl.innerHTML = `
    <div>
      <strong>Cuộc gọi đến từ:</strong> Khách (${sessionId})
    </div>
    <div style="display: flex; gap: 10px;">
      <button class="btn btn-accept" onclick="acceptCall('${sessionId}', '${callerId}')">Nhận</button>
      <button class="btn btn-reject" onclick="rejectCall('${sessionId}', '${callerId}')">Từ chối</button>
    </div>
  `;
  incomingCallsContainer.appendChild(callEl);
});

socket.on('call:ended', () => {
  alert('Cuộc gọi đã kết thúc.');
  endCall();
});

socket.on('webrtc:signal', async ({ senderId, signal }) => {
  if (senderId !== currentCallerId) return;

  if (signal.type === 'offer') {
    // Should not happen for admin, as admin creates answer, but just in case
    await peerConnection.setRemoteDescription(new RTCSessionDescription(signal));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('webrtc:signal', { targetId: senderId, signal: peerConnection.localDescription });
  } else if (signal.type === 'answer') {
    // When Guest answers our offer, or Guest creates offer and we answered
    // Actually, Guest sends Offer -> Admin sends Answer.
    // Wait, let's establish the roles:
    // Guest calls Admin -> Admin accepts.
    // Admin creates Offer? Or Guest creates Offer?
    // Let's have Admin create the Answer if Guest sends the Offer.
  } else if (signal.candidate) {
    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(signal));
    } catch (e) {
      console.error('Error adding received ice candidate', e);
    }
  }
});

// Since Guest initiated, let's have Guest create the Offer when Admin accepts.
socket.on('webrtc:signal', async ({ senderId, signal }) => {
  if (!peerConnection) return;
  if (signal.type === 'offer') {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(signal));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('webrtc:signal', { targetId: senderId, signal: peerConnection.localDescription });
  }
});

// --- MEDIA & CALL LOGIC ---
async function setupLocalStream() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
  } catch (err) {
    alert('Không thể truy cập Camera/Micro: ' + err.message);
    throw err;
  }
}

window.acceptCall = async (sessionId, callerId) => {
  // Remove incoming call UI
  const callEl = document.getElementById(`call-${callerId}`);
  if (callEl) callEl.remove();

  try {
    await setupLocalStream();

    currentCallerId = callerId;
    videoContainer.style.display = 'flex';
    endCallBtn.style.display = 'inline-block';

    // Initialize WebRTC
    peerConnection = new RTCPeerConnection(peerConnectionConfig);

    // Add local stream tracks to peer connection
    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });

    // Handle incoming streams
    peerConnection.ontrack = (event) => {
      remoteVideo.srcObject = event.streams[0];
    };

    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('webrtc:signal', {
          targetId: callerId,
          signal: event.candidate
        });
      }
    };

    // Notify guest that we accepted, Guest will send an Offer
    socket.emit('call:accept', { sessionId });

    // Initial button states
    updateControlButtons();
  } catch (e) {
    console.error(e);
  }
};

function updateControlButtons() {
  if (!localStream) return;
  const audioTrack = localStream.getAudioTracks()[0];
  const videoTrack = localStream.getVideoTracks()[0];

  if (adminMuteBtn) {
    adminMuteBtn.classList.toggle('is-off', !audioTrack.enabled);
  }
  if (adminVideoBtn) {
    adminVideoBtn.classList.toggle('is-off', !videoTrack.enabled);
    
    // Toggle placeholder
    let placeholder = document.getElementById('admin-video-placeholder');
    if (!videoTrack.enabled) {
      if (!placeholder) {
        placeholder = document.createElement('div');
        placeholder.id = 'admin-video-placeholder';
        placeholder.className = 'video-off-placeholder';
        placeholder.innerHTML = '<div style="font-size: 40px;">🎙️</div><div style="margin-top:10px; font-size:12px;">Camera đang tắt</div>';
        localVideo.parentElement.appendChild(placeholder);
      }
    } else if (placeholder) {
      placeholder.remove();
    }
  }
}

if (adminMuteBtn) {
  adminMuteBtn.addEventListener('click', () => {
    if (localStream) {
      const track = localStream.getAudioTracks()[0];
      track.enabled = !track.enabled;
      updateControlButtons();
    }
  });
}

if (adminVideoBtn) {
  adminVideoBtn.addEventListener('click', () => {
    if (localStream) {
      const track = localStream.getVideoTracks()[0];
      track.enabled = !track.enabled;
      updateControlButtons();
    }
  });
}

window.rejectCall = (sessionId, callerId) => {
  const callEl = document.getElementById(`call-${callerId}`);
  if (callEl) callEl.remove();
  socket.emit('call:reject', { sessionId });
};

function endCall() {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }

  if (currentCallerId) {
    socket.emit('call:end', { targetId: currentCallerId });
    currentCallerId = null;
  }

  videoContainer.style.display = 'none';
  endCallBtn.style.display = 'none';
  remoteVideo.srcObject = null;
  localVideo.srcObject = null;
}

endCallBtn.addEventListener('click', endCall);
