import { marked } from 'marked';
import DOMPurify from 'dompurify';

const state = {
    projectId: null,
    currentUser: null,
    imageFiles: [],
    replyingTo: null, // parent_comment_id
};

const elements = {
    projectTitle: document.getElementById('project-title'),
    commentsContainer: document.getElementById('comments-container'),
    commentForm: document.getElementById('comment-form'),
    commentInput: document.getElementById('comment-input'),
    currentUserAvatar: document.getElementById('current-user-avatar'),
    imageUpload: document.getElementById('image-upload'),
    imagePreviewContainer: document.getElementById('image-preview-container'),
    loading: document.getElementById('loading'),
};

async function init() {
    try {
        const [project, user] = await Promise.all([
            window.websim.getCurrentProject(),
            window.websim.getCurrentUser(),
        ]);

        state.projectId = project.id;
        state.currentUser = user;

        elements.projectTitle.textContent = project.title;
        elements.currentUserAvatar.src = user?.avatar_url || 'default_avatar.png';
        
        loadComments();
        setupEventListeners();
    } catch (error) {
        console.error("Initialization failed:", error);
        elements.loading.textContent = 'Failed to load project data.';
    }
}

async function loadComments() {
    try {
        const response = await fetch(`/api/v1/projects/${state.projectId}/comments`);
        if (!response.ok) throw new Error('Failed to fetch comments');
        const data = await response.json();
        
        elements.loading.style.display = 'none';
        elements.commentsContainer.innerHTML = '';
        
        if (data.comments.data.length === 0) {
            elements.commentsContainer.textContent = 'No comments yet. Be the first to post!';
        } else {
            data.comments.data.forEach(commentData => {
                const commentElement = createCommentElement(commentData.comment);
                elements.commentsContainer.prepend(commentElement); // Prepend to show newest first
            });
        }
    } catch (error) {
        console.error("Failed to load comments:", error);
        elements.loading.textContent = 'Could not load comments.';
    }
}

function createCommentElement(comment) {
    const div = document.createElement('div');
    div.className = 'comment';
    div.id = `comment-${comment.id}`;
    div.dataset.commentId = comment.id;

    const sanitizedHtml = DOMPurify.sanitize(marked.parse(comment.raw_content));

    div.innerHTML = `
        <img src="${comment.author.avatar_url || 'default_avatar.png'}" alt="${comment.author.username}'s avatar" class="avatar">
        <div class="comment-main">
            <div class="comment-header">
                <span class="comment-author">${comment.author.username}</span>
            </div>
            <div class="comment-content">${sanitizedHtml}</div>
            <div class="comment-actions">
                <button class="reply-button">Reply</button>
            </div>
            <div class="replies-container" id="replies-${comment.id}"></div>
        </div>
    `;

    if (comment.reply_count > 0) {
        loadReplies(comment.id);
    }

    div.querySelector('.reply-button').addEventListener('click', () => {
        state.replyingTo = comment.id;
        elements.commentInput.placeholder = `Replying to ${comment.author.username}...`;
        elements.commentInput.focus();
    });

    return div;
}

async function loadReplies(commentId) {
    try {
        const response = await fetch(`/api/v1/projects/${state.projectId}/comments/${commentId}/replies`);
        if (!response.ok) return;
        const data = await response.json();
        const repliesContainer = document.getElementById(`replies-${commentId}`);
        if (!repliesContainer) return;

        data.comments.data.forEach(replyData => {
            const replyElement = createCommentElement(replyData.comment);
            repliesContainer.prepend(replyElement); // Show newest first
        });
    } catch (error) {
        console.error(`Failed to load replies for ${commentId}:`, error);
    }
}

function setupEventListeners() {
    elements.commentForm.addEventListener('submit', handlePostComment);
    elements.imageUpload.addEventListener('change', handleImageSelection);
    window.websim.addEventListener('comment:created', handleRealtimeComment);
    
    // Cancel reply state if user clicks away from input
    elements.commentInput.addEventListener('blur', () => {
        setTimeout(() => { // Timeout to allow form submission to process first
            if (document.activeElement !== elements.commentForm.querySelector('button')) {
                resetFormState();
            }
        }, 200);
    });
}

async function handlePostComment(e) {
    e.preventDefault();
    const content = elements.commentInput.value.trim();
    if (!content && state.imageFiles.length === 0) return;

    const submitButton = elements.commentForm.querySelector('button');
    submitButton.disabled = true;
    submitButton.textContent = 'Posting...';

    try {
        let imageUrls = [];
        if (state.imageFiles.length > 0) {
            imageUrls = await Promise.all(
                state.imageFiles.map(file => window.websim.upload(file))
            );
        }

        window.websim.postComment({
            content: content,
            images: imageUrls,
            parent_comment_id: state.replyingTo
        });
        
        // The real-time event listener will handle adding the comment to the DOM.
        // We just reset the form here.
        elements.commentInput.value = '';
        state.imageFiles = [];
        updateImagePreview();
        resetFormState();

    } catch (error) {
        console.error("Failed to post comment:", error);
        alert('Could not post comment. Please try again.');
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = 'Post';
    }
}

function handleImageSelection(e) {
    const newFiles = Array.from(e.target.files);
    state.imageFiles.push(...newFiles);
    if (state.imageFiles.length > 4) {
        state.imageFiles = state.imageFiles.slice(0, 4);
        alert('You can upload a maximum of 4 images.');
    }
    updateImagePreview();
    // Reset file input to allow selecting the same file again
    e.target.value = null;
}

function updateImagePreview() {
    elements.imagePreviewContainer.innerHTML = '';
    state.imageFiles.forEach((file, index) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const previewWrapper = document.createElement('div');
            previewWrapper.className = 'image-preview';
            previewWrapper.innerHTML = `
                <img src="${e.target.result}" alt="Image preview">
                <button class="remove-image-btn" data-index="${index}">&times;</button>
            `;
            elements.imagePreviewContainer.appendChild(previewWrapper);
        };
        reader.readAsDataURL(file);
    });
}

elements.imagePreviewContainer.addEventListener('click', (e) => {
    if (e.target.classList.contains('remove-image-btn')) {
        const index = parseInt(e.target.dataset.index, 10);
        state.imageFiles.splice(index, 1);
        updateImagePreview();
    }
});


function handleRealtimeComment(data) {
    const { comment } = data;
    if (comment.project_id !== state.projectId) return;

    const newCommentElement = createCommentElement(comment);
    
    if (comment.parent_comment_id) {
        const repliesContainer = document.getElementById(`replies-${comment.parent_comment_id}`);
        if (repliesContainer) {
            repliesContainer.append(newCommentElement); // Append new replies at the bottom
        }
    } else {
        elements.commentsContainer.prepend(newCommentElement);
        if(elements.commentsContainer.textContent.includes('No comments yet.')) {
            elements.commentsContainer.textContent = '';
        }
        elements.commentsContainer.prepend(newCommentElement);
    }
}

function resetFormState() {
    state.replyingTo = null;
    elements.commentInput.placeholder = 'Add a comment...';
}

document.addEventListener('DOMContentLoaded', init);

